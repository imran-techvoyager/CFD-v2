import type { AssetSymbol } from "./types";

export interface InstrumentMeta {
  symbol: AssetSymbol;
  name: string;
  /** units of the underlying per 1.00 lot */
  contractSize: number;
  /** price increment used for pip-value display */
  pip: number;
  /** decimal places for price display */
  digits: number;
  /** watchlist icon */
  glyph: string;
  color: string;
}

export const INSTRUMENTS: Record<AssetSymbol, InstrumentMeta> = {
  BTC: {
    symbol: "BTC",
    name: "Bitcoin vs US Dollar",
    contractSize: 1,
    pip: 0.1,
    digits: 2,
    glyph: "₿",
    color: "#f7931a",
  },
  ETH: {
    symbol: "ETH",
    name: "Ethereum vs US Dollar",
    contractSize: 1,
    pip: 0.01,
    digits: 2,
    glyph: "Ξ",
    color: "#627eea",
  },
  SOL: {
    symbol: "SOL",
    name: "Solana vs US Dollar",
    contractSize: 1,
    pip: 0.001,
    digits: 3,
    glyph: "◎",
    color: "#9945ff",
  },
};

export const SYMBOLS: AssetSymbol[] = ["BTC", "ETH", "SOL"];

export const LEVERAGES = [1, 5, 10, 20, 50, 100, 200, 400] as const;

export function accountLeverage(symbol: AssetSymbol): number {
  if (typeof window === "undefined") return 100;
  const v = Number(localStorage.getItem(`leverage:${symbol}`));
  return LEVERAGES.includes(v as any) ? v : 100;
}

export function setAccountLeverage(symbol: AssetSymbol, lev: number) {
  localStorage.setItem(`leverage:${symbol}`, String(lev));
}
