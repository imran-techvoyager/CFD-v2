import prismaClient from "@repo/db/client";
import type { ModifyTradePayload } from "@repo/shared";
import { ORDER, PRICESTORE } from "../state";
import { publishOrderEvent } from "./events";

export type ModifyResult =
  | { ok: true; takeProfit?: number; stopLoss?: number }
  | { ok: false; error: string };

/**
 * Updates TP/SL on a running position. Validated against the CURRENT exit
 * price (not the entry) so profit-locking moves — e.g. raising a stop above
 * entry — are allowed, while levels that would fire instantly are rejected.
 *
 * Naturally idempotent: replaying the same modify re-applies the same values.
 */
export async function modifyOrder(payload: ModifyTradePayload): Promise<ModifyResult> {
  const { orderId, userId, takeProfit, stopLoss } = payload;

  const order = ORDER[orderId];
  if (!order || order.userId !== userId) {
    return { ok: false, error: "order-not-found" };
  }

  const priceData = PRICESTORE[order.asset];
  if (!priceData) return { ok: false, error: "no-price-available" };
  const exitPrice = order.type === "buy" ? priceData.bid : priceData.ask;

  const newTp = takeProfit === undefined ? order.takeProfit : takeProfit ?? undefined;
  const newSl = stopLoss === undefined ? order.stopLoss : stopLoss ?? undefined;

  if (newTp !== undefined) {
    if (order.type === "buy" && newTp <= exitPrice)
      return { ok: false, error: "take-profit-must-be-above-price" };
    if (order.type === "sell" && newTp >= exitPrice)
      return { ok: false, error: "take-profit-must-be-below-price" };
  }
  if (newSl !== undefined) {
    if (order.type === "buy" && newSl >= exitPrice)
      return { ok: false, error: "stop-loss-must-be-below-price" };
    if (order.type === "sell" && newSl <= exitPrice)
      return { ok: false, error: "stop-loss-must-be-above-price" };
  }

  try {
    await prismaClient.openOrders.update({
      where: { orderId },
      data: {
        takeProfit: newTp !== undefined ? BigInt(newTp) : null,
        stopLoss: newSl !== undefined ? BigInt(newSl) : null,
      },
    });
  } catch {
    // row already gone => closed between our memory check and the write
    return { ok: false, error: "order-not-found" };
  }

  order.takeProfit = newTp;
  order.stopLoss = newSl;

  console.log(
    `[ENGINE] Modified ${orderId}: TP=${newTp ?? "—"} SL=${newSl ?? "—"}`
  );

  publishOrderEvent(userId, {
    event: "order-modified",
    orderId,
    asset: order.asset,
    takeProfit: newTp,
    stopLoss: newSl,
  });

  return { ok: true, takeProfit: newTp, stopLoss: newSl };
}
