import { redis } from "@repo/redis/client";

export const PRICESTORE: Record<string, { ask: number; bid: number }> = {};

export const ORDER: Record<
  string,
  {
    userId: string;
    type: "buy" | "sell";
    asset: string;
    margin: number;
    leverage: number;
    openPrice: number;
    timestamp: number;
    takeProfit?: number;
    stopLoss?: number;
    liquidation?: number;
  }
> = {};

async function engine(){
    await redis.connect();
}

engine();