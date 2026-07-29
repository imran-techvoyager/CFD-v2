import z from "zod";
import { assetSchema, leverageSchema, tradeSideSchema } from "@repo/shared";

export const authSchema = z.object({
  email: z.string().email().min(3).max(100),
  password: z.string().min(8).max(50),
});

export type FinalSchema = z.infer<typeof authSchema>;

// All values in human units: volume in lots, takeprofit/stoploss are prices in USD.
export const tradeSchema = z.object({
  asset: assetSchema,
  type: tradeSideSchema,
  volume: z.number().min(0.01).max(10_000),
  leverage: leverageSchema,
  takeprofit: z.number().positive().optional(),
  stoploss: z.number().positive().optional(),
});

export const closeTradeSchema = z.object({
  orderId: z.string().uuid(),
  // optional partial close volume in lots
  volume: z.number().min(0.01).max(10_000).optional(),
});

// null clears a level, undefined leaves it unchanged
export const modifyTradeSchema = z.object({
  orderId: z.string().uuid(),
  takeprofit: z.number().positive().nullable().optional(),
  stoploss: z.number().positive().nullable().optional(),
});
