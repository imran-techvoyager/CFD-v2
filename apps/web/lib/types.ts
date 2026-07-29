export type AssetSymbol = "BTC" | "ETH" | "SOL";

export interface Tick {
  symbol: AssetSymbol;
  bid: number; // decimal USD
  ask: number; // decimal USD
  time: number; // seconds epoch
}

export interface OpenOrder {
  orderId: string;
  asset: AssetSymbol;
  type: "buy" | "sell";
  volume: number; // lots
  margin: number; // USD
  leverage: number;
  openPrice: number;
  takeProfit: number | null;
  stopLoss: number | null;
  liquidation: number | null;
  timestamp: number;
}

export interface ClosedOrder {
  orderId: string;
  asset: AssetSymbol;
  type: "buy" | "sell";
  volume: number; // lots
  openPrice: number;
  closePrice: number;
  margin: number;
  pnl: number;
  leverage: number;
  closeReason: "manual" | "take_profit" | "stop_loss" | "liquidation";
  timestamp: string;
  closeTimestamp: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface User {
  email: string;
  balance: number;
}
