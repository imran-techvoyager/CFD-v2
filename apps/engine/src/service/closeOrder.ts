import { ORDER, untrackOrder } from "../state";
import prismaClient from "@repo/db/client";
import { CONTRACT_SIZE, type Asset } from "@repo/shared";
import { calculatePnl } from "./calculatePnl";
import { type CloseOrderReason } from "../types/types";
import { publishOrderEvent } from "./events";

/**
 * Fully closes an order: persists the ClosedOrders row, deletes the
 * OpenOrders row and credits margin+pnl back to the user — one transaction.
 *
 * Idempotent across crash/replay: ClosedOrders.orderId is unique, so a
 * replayed close of an already-closed order fails the insert and changes
 * nothing.
 */
export async function closeOrder(
  orderId: string,
  reason: CloseOrderReason,
  closePrice: number
): Promise<number | null> {
  const order = ORDER[orderId];
  if (!order) return null;

  const pnl = calculatePnl({
    side: order.type,
    openPrice: order.openPrice,
    closePrice,
    volume: order.volume,
    contractSize: CONTRACT_SIZE[order.asset as Asset] ?? 1,
    margin: order.margin,
  });

  try {
    await prismaClient.$transaction([
      prismaClient.closedOrders.create({
        data: {
          orderId,
          userId: order.userId,
          type: order.type,
          asset: order.asset,
          openPrice: BigInt(order.openPrice),
          closePrice: BigInt(Math.round(closePrice)),
          margin: BigInt(order.margin),
          volume: order.volume,
          pnl: BigInt(pnl),
          leverage: order.leverage,
          closeReason: reason,
          timestamp: new Date(order.timestamp),
          closeTimestamp: new Date(),
        },
      }),
      prismaClient.openOrders.deleteMany({ where: { orderId } }),
      prismaClient.user.update({
        where: { id: order.userId },
        data: { balance: { increment: order.margin + pnl } },
      }),
    ]);
  } catch (err: any) {
    // unique violation => this close was already processed (stream replay)
    if (err?.code === "P2002") {
      console.warn(`[ENGINE] Order ${orderId} already closed, skipping replay.`);
      untrackOrder(orderId);
      return null;
    }
    throw err;
  }

  untrackOrder(orderId);

  console.log(
    `[ENGINE] Closed ${orderId} (${reason}) pnl=$${(pnl / 100).toFixed(2)}`
  );

  publishOrderEvent(order.userId, {
    event: "order-closed",
    orderId,
    asset: order.asset,
    type: order.type,
    openPrice: order.openPrice,
    closePrice: Math.round(closePrice),
    margin: order.margin,
    volume: order.volume,
    leverage: order.leverage,
    pnl,
    reason,
  });

  return pnl;
}

/**
 * Partially closes an order: books pnl + releases margin for the closed
 * fraction, shrinks the open order — one transaction.
 *
 * The history row is keyed by the *command id* (unique per HTTP request), so
 * a crash replay of the same partial close violates the unique constraint
 * and becomes a no-op, exactly like full closes.
 */
export async function partialCloseOrder(
  commandId: string,
  orderId: string,
  closeVolume: number,
  closePrice: number
): Promise<number | null> {
  const order = ORDER[orderId];
  if (!order) return null;

  // proportional margin release, floored; the remainder keeps the extra cent
  const closedMargin = Math.floor((order.margin * closeVolume) / order.volume);
  const remainingVolume = order.volume - closeVolume;
  const remainingMargin = order.margin - closedMargin;

  const pnl = calculatePnl({
    side: order.type,
    openPrice: order.openPrice,
    closePrice,
    volume: closeVolume,
    contractSize: CONTRACT_SIZE[order.asset as Asset] ?? 1,
    margin: closedMargin,
  });

  try {
    await prismaClient.$transaction([
      prismaClient.closedOrders.create({
        data: {
          orderId: commandId, // deterministic id => replay-safe
          userId: order.userId,
          type: order.type,
          asset: order.asset,
          openPrice: BigInt(order.openPrice),
          closePrice: BigInt(Math.round(closePrice)),
          margin: BigInt(closedMargin),
          volume: closeVolume,
          pnl: BigInt(pnl),
          leverage: order.leverage,
          closeReason: "manual",
          timestamp: new Date(order.timestamp),
          closeTimestamp: new Date(),
        },
      }),
      prismaClient.openOrders.update({
        where: { orderId },
        data: { volume: remainingVolume, margin: BigInt(remainingMargin) },
      }),
      prismaClient.user.update({
        where: { id: order.userId },
        data: { balance: { increment: closedMargin + pnl } },
      }),
    ]);
  } catch (err: any) {
    if (err?.code === "P2002") {
      console.warn(`[ENGINE] Partial close ${commandId} already processed, skipping replay.`);
      return null;
    }
    throw err;
  }

  order.volume = remainingVolume;
  order.margin = remainingMargin;

  console.log(
    `[ENGINE] Partially closed ${orderId}: ${(closeVolume / 100).toFixed(2)} lots, pnl=$${(pnl / 100).toFixed(2)}, ${(remainingVolume / 100).toFixed(2)} lots remain`
  );

  publishOrderEvent(order.userId, {
    event: "order-closed",
    orderId,
    partial: true,
    asset: order.asset,
    type: order.type,
    openPrice: order.openPrice,
    closePrice: Math.round(closePrice),
    margin: closedMargin,
    volume: closeVolume,
    remainingVolume,
    leverage: order.leverage,
    pnl,
    reason: "manual",
  });

  return pnl;
}
