import { z } from "zod";

/**
 * The single source of truth for every message that crosses a process
 * boundary (backend <-> engine <-> poller <-> websocket relay).
 * Both producers and consumers import these schemas, so a contract change
 * is a compile error everywhere at once — and every consumer validates at
 * the boundary instead of trusting the wire.
 */

// ---------------------------------------------------------------- constants

export const ASSETS = ["BTC", "ETH", "SOL"] as const;
export type Asset = (typeof ASSETS)[number];
export const assetSchema = z.enum(ASSETS);

export const LEVERAGES = [1, 5, 10, 20, 50, 100, 200, 400] as const;
export type Leverage = (typeof LEVERAGES)[number];
export const leverageSchema = z
  .number()
  .int()
  .refine((l): l is Leverage => (LEVERAGES as readonly number[]).includes(l), {
    message: "invalid leverage",
  });

export const tradeSideSchema = z.enum(["buy", "sell"]);
export type TradeSide = z.infer<typeof tradeSideSchema>;

/** Volume travels as integer hundredths of a lot (0.01 lot = 1). */
export const VOLUME_SCALE = 100;

/** Units of the underlying per 1.00 lot. */
export const CONTRACT_SIZE: Record<Asset, number> = {
  BTC: 1,
  ETH: 1,
  SOL: 1,
};

/** Smallest quoted price increment used for pip-value display. */
export const PIP_SIZE: Record<Asset, number> = {
  BTC: 0.1,
  ETH: 0.01,
  SOL: 0.001,
};

export const STREAMS = {
  ENGINE: "engine-stream",
  CALLBACKS: "callback-queue",
} as const;

export const CHANNELS = {
  ORDER_EVENTS: "order-events",
} as const;

/** Commands older than this are refused by the engine: the requester's HTTP
 *  call has long since timed out, so executing late would silently open
 *  exposure nobody asked for. */
export const COMMAND_TTL_MS = 15_000;

/** Opens are refused when the newest tick for the symbol is older than this
 *  (feed outage / snapshot-restored prices). Closes stay allowed — trapping
 *  users in a position during a feed outage is worse than a stale exit. */
export const PRICE_STALENESS_MS = 10_000;

// --------------------------------------------------- engine-stream messages

const intPrice = z.number().int().positive();
const intVolume = z.number().int().positive(); // hundredths of a lot

export const priceUpdateSchema = z.object({
  kind: z.literal("price-update"),
  payload: z.object({
    symbol: assetSchema,
    askPrice: intPrice, // 1e4 scale
    bidPrice: intPrice, // 1e4 scale
    time: z.number().optional(), // seconds epoch
    decimal: z.number().optional(),
  }),
});
export type PriceUpdate = z.infer<typeof priceUpdateSchema>;

export const placeTradePayloadSchema = z.object({
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  asset: assetSchema,
  type: tradeSideSchema,
  volume: intVolume, // hundredths of a lot
  leverage: leverageSchema,
  takeProfit: intPrice.optional(), // 1e4 scale
  stopLoss: intPrice.optional(), // 1e4 scale
  timestamp: z.number(),
});
export type PlaceTradePayload = z.infer<typeof placeTradePayloadSchema>;

export const closeTradePayloadSchema = z.object({
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  /** omit for a full close; a value below the order's volume closes partially */
  volume: intVolume.optional(),
  timestamp: z.number(),
});
export type CloseTradePayload = z.infer<typeof closeTradePayloadSchema>;

export const modifyTradePayloadSchema = z.object({
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  /** undefined = leave unchanged, null = clear, number = set (1e4 scale) */
  takeProfit: intPrice.nullable().optional(),
  stopLoss: intPrice.nullable().optional(),
  timestamp: z.number(),
});
export type ModifyTradePayload = z.infer<typeof modifyTradePayloadSchema>;

export const engineRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("place-trade"), payload: placeTradePayloadSchema }),
  z.object({ kind: z.literal("close-trade"), payload: closeTradePayloadSchema }),
  z.object({ kind: z.literal("modify-trade"), payload: modifyTradePayloadSchema }),
  z.object({
    kind: z.literal("get-open-orders"),
    payload: z.object({ userId: z.string().uuid() }),
  }),
]);
export type EngineRequest = z.infer<typeof engineRequestSchema>;

export const engineCommandSchema = z.object({
  id: z.string(),
  request: engineRequestSchema,
});
export type EngineCommand = z.infer<typeof engineCommandSchema>;

/** Everything that may appear on engine-stream. */
export const engineStreamMessageSchema = z.union([
  priceUpdateSchema,
  engineCommandSchema,
]);
export type EngineStreamMessage = z.infer<typeof engineStreamMessageSchema>;

// ------------------------------------------------------------------- utils

/** Compare two redis stream ids ("ms-seq"). Returns <0, 0, >0. */
export function compareStreamIds(a: string, b: string): number {
  const [amsRaw, aseqRaw] = a.split("-");
  const [bmsRaw, bseqRaw] = b.split("-");
  const ams = Number(amsRaw ?? 0);
  const bms = Number(bmsRaw ?? 0);
  if (ams !== bms) return ams - bms;
  return Number(aseqRaw ?? 0) - Number(bseqRaw ?? 0);
}
