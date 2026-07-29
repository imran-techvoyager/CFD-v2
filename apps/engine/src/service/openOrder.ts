import prismaClient from "@repo/db/client";
import {
  COMMAND_TTL_MS,
  CONTRACT_SIZE,
  PRICE_STALENESS_MS,
  type PlaceTradePayload,
} from "@repo/shared";
import { PRICESTORE, trackOrder, type OpenOrder } from "../state";
import { calculateLiquidationPrice, calculateMargin } from "./calculatePnl";
import { publishOrderEvent } from "./events";

export type OpenResult =
  | { ok: true; openPrice: number; liquidation: number; margin: number }
  | { ok: false; error: string };

/**
 * Opens a position: computes margin from notional/leverage at the execution
 * price, atomically deducts it from the user's balance (only if sufficient)
 * and persists the OpenOrders row keyed by the unique orderId — one
 * transaction.
 *
 * Exactly-once across crashes:
 *  - `replay === true` means this command sits at-or-before the stream
 *    position the engine had already reached before the crash, so it MAY
 *    have been executed. We consult the DB (OpenOrders/ClosedOrders by
 *    orderId) and either restore in-memory state or skip.
 *  - On the live path we skip those lookups — orderIds are fresh UUIDs
 *    minted per HTTP request, and the unique constraint still backstops us.
 */
export async function openOrder(
  params: PlaceTradePayload,
  { replay }: { replay: boolean }
): Promise<OpenResult> {
  const { orderId, userId, asset, type, volume, leverage, takeProfit, stopLoss, timestamp } = params;

  if (replay) {
    const [existsOpen, existsClosed] = await Promise.all([
      prismaClient.openOrders.findUnique({ where: { orderId } }),
      prismaClient.closedOrders.findUnique({ where: { orderId }, select: { orderId: true } }),
    ]);
    if (existsOpen) {
      trackOrder(orderId, {
        userId,
        type,
        asset,
        margin: Number(existsOpen.margin),
        volume: existsOpen.volume,
        leverage: existsOpen.leverage,
        openPrice: Number(existsOpen.openPrice),
        timestamp: existsOpen.timestamp.getTime(),
        takeProfit: existsOpen.takeProfit ? Number(existsOpen.takeProfit) : undefined,
        stopLoss: existsOpen.stopLoss ? Number(existsOpen.stopLoss) : undefined,
        liquidation: Number(existsOpen.liquidation),
      });
      return {
        ok: true,
        openPrice: Number(existsOpen.openPrice),
        liquidation: Number(existsOpen.liquidation),
        margin: Number(existsOpen.margin),
      };
    }
    if (existsClosed) return { ok: false, error: "order-already-closed" };
  }

  // A command that was never executed and is older than the requester's HTTP
  // timeout must be refused — executing it late would open exposure nobody
  // is waiting to hear about.
  if (Date.now() - timestamp > COMMAND_TTL_MS) {
    return { ok: false, error: "request-expired" };
  }

  const priceData = PRICESTORE[asset];
  if (!priceData) return { ok: false, error: "no-price-available" };
  if (Date.now() - priceData.updatedAt > PRICE_STALENESS_MS) {
    return { ok: false, error: "stale-price" };
  }

  const openPrice = type === "buy" ? priceData.ask : priceData.bid;
  const contract = CONTRACT_SIZE[asset];
  const margin = calculateMargin(openPrice, volume, contract, leverage);
  if (margin <= 0) return { ok: false, error: "volume-too-small" };
  const liquidation = calculateLiquidationPrice(type, openPrice, leverage);

  // TP/SL that would fire instantly on the next tick are user error — reject
  if (takeProfit) {
    if (type === "buy" && takeProfit <= openPrice)
      return { ok: false, error: "take-profit-must-be-above-entry" };
    if (type === "sell" && takeProfit >= openPrice)
      return { ok: false, error: "take-profit-must-be-below-entry" };
  }
  if (stopLoss) {
    if (type === "buy" && stopLoss >= openPrice)
      return { ok: false, error: "stop-loss-must-be-below-entry" };
    if (type === "sell" && stopLoss <= openPrice)
      return { ok: false, error: "stop-loss-must-be-above-entry" };
  }

  // conditional margin deduction + order row, atomically; the WHERE guard on
  // balance makes concurrent placements race-safe at the database level
  const result = await prismaClient.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId, balance: { gte: margin } },
      data: { balance: { decrement: margin } },
    });
    if (updated.count === 0) return "insufficient-balance" as const;

    await tx.openOrders.create({
      data: {
        orderId,
        userId,
        asset,
        type,
        openPrice: BigInt(openPrice),
        margin: BigInt(margin),
        volume,
        leverage,
        takeProfit: takeProfit ? BigInt(takeProfit) : null,
        stopLoss: stopLoss ? BigInt(stopLoss) : null,
        liquidation: BigInt(liquidation),
        timestamp: new Date(timestamp),
      },
    });
    return "ok" as const;
  });

  if (result === "insufficient-balance")
    return { ok: false, error: "insufficient-balance" };

  const order: OpenOrder = {
    userId,
    type,
    asset,
    margin,
    volume,
    leverage,
    openPrice,
    timestamp,
    takeProfit,
    stopLoss,
    liquidation,
  };
  trackOrder(orderId, order);

  console.log(
    `[ENGINE] Opened ${orderId} ${type} ${(volume / 100).toFixed(2)} lots ${asset} @ ${openPrice} lev=${leverage} margin=$${(margin / 100).toFixed(2)}`
  );

  publishOrderEvent(userId, {
    event: "order-opened",
    orderId,
    asset,
    type,
    openPrice,
    margin,
    volume,
    leverage,
    takeProfit,
    stopLoss,
    liquidation,
    timestamp,
  });

  return { ok: true, openPrice, liquidation, margin };
}
