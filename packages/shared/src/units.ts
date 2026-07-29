/**
 * Money & price fixed-point conventions used across the whole platform.
 *
 *  - Prices travel as integers scaled by 1e4   ($61,428.5033 -> 614285033)
 *  - Money (balances, margin, pnl) as integer cents (1e2)
 *
 * Integer math end-to-end means no floating point drift in anything that
 * touches a balance. The HTTP API converts to decimal USD at the boundary.
 */
export const PRICE_SCALE = 10_000;
export const MONEY_SCALE = 100;

export function toInternalPrice(price: number): number {
  return Math.round(price * PRICE_SCALE);
}

export function fromInternalPrice(price: number | bigint): number {
  return Number(price) / PRICE_SCALE;
}

export function toInternalUsd(usd: number): number {
  return Math.round(usd * MONEY_SCALE);
}

export function fromInternalUsd(cents: number | bigint): number {
  return Number(cents) / MONEY_SCALE;
}
