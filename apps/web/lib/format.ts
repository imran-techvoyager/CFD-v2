import { INSTRUMENTS } from "./instruments";
import type { AssetSymbol, OpenOrder, Tick } from "./types";

export function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtSymbolPrice(
  symbol: AssetSymbol,
  v: number | null | undefined
): string {
  return fmtPrice(v, INSTRUMENTS[symbol].digits);
}

export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtSignedUsd(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtLots(v: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** live pnl in USD from position size, clamped at -margin like the engine */
export function livePnl(order: OpenOrder, tick: Tick | undefined): number | null {
  if (!tick) return null;
  const exit = order.type === "buy" ? tick.bid : tick.ask;
  const units = order.volume * INSTRUMENTS[order.asset].contractSize;
  const diff = order.type === "buy" ? exit - order.openPrice : order.openPrice - exit;
  const pnl = diff * units;
  return Math.max(pnl, -order.margin);
}

export const REASON_LABEL: Record<string, string> = {
  manual: "Manual",
  take_profit: "Take profit",
  stop_loss: "Stop loss",
  liquidation: "Liquidated",
};
