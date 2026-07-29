// apps/engine/src/state.ts
//
// The engine is deliberately single-threaded: one stream-reader loop owns all
// mutable state, so there are no locks and no data races by construction —
// the same model real matching engines (LMAX, exchange cores) use. Anything
// that must survive a crash is written to Postgres transactionally; this
// in-memory state is the hot path only.

import type { TradeSide } from "@repo/shared";

export interface PriceEntry {
  ask: number; // 1e4 scale
  bid: number; // 1e4 scale
  updatedAt: number; // ms epoch of the last tick — used for staleness guards
}

export const PRICESTORE: Record<string, PriceEntry> = {};

export interface OpenOrder {
  userId: string;
  type: TradeSide;
  asset: string;
  margin: number; // cents
  volume: number; // hundredths of a lot
  leverage: number;
  openPrice: number; // 1e4 scale
  timestamp: number; // ms epoch
  takeProfit?: number; // 1e4 scale
  stopLoss?: number; // 1e4 scale
  liquidation: number; // 1e4 scale (0 = can never liquidate, e.g. 1x buy)
}

export const ORDER: Record<string, OpenOrder> = {};

/**
 * Secondary index: symbol -> orderIds. Ticks are the hottest code path
 * (every ~100ms per symbol), so trigger checks must only visit orders on the
 * ticking symbol instead of scanning the whole book.
 */
export const ORDERS_BY_SYMBOL = new Map<string, Set<string>>();

export function trackOrder(orderId: string, order: OpenOrder) {
  ORDER[orderId] = order;
  let set = ORDERS_BY_SYMBOL.get(order.asset);
  if (!set) {
    set = new Set();
    ORDERS_BY_SYMBOL.set(order.asset, set);
  }
  set.add(orderId);
}

export function untrackOrder(orderId: string) {
  const order = ORDER[orderId];
  if (!order) return;
  delete ORDER[orderId];
  ORDERS_BY_SYMBOL.get(order.asset)?.delete(orderId);
}
