import { redis } from "@repo/redis/client";
import prismaClient from "@repo/db/client";
import { checkOpenOrders } from "./service/checkOrders";
import { closeOrder as serviceCloseOrder } from "./service/closeOrder";

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

// Two redis clients: one for reading (xread), another for publishing (xadd)
const reader = redis.duplicate();
const publisher = redis.duplicate();

async function publishCallback(fields: Record<string, string>) {
  // Convert fields object to array Redis xadd expects: [k1, v1, k2, v2, ...]
  const arr: string[] = [];
  for (const k of Object.keys(fields)) {
    arr.push(k, String(fields[k]));
  }
  await publisher.xadd("callback-queue", "*", ...arr);
}

/**
 * Parse a single xread message's fields into { kind, payload }.
 * Supports both:
 *  - ... "kind", "place-trade", "payload", "<json>"
 *  - ... "data", "<json-of-{kind,payload}>"
 */
function parseFields(fields: string[]): { kind?: string; payload?: any } {
  const id_Kind = fields.indexOf("kind");
  const id_Payload = fields.indexOf("payload");
  if (id_Kind !== -1 && id_Payload !== -1) {
    try {
      const kind = fields[id_Kind + 1];
      const payload = JSON.parse(fields[id_Payload + 1] ?? "");
      return { kind, payload };
    } catch (e) {
      console.error("failed parse kind/payload", e);
      return {};
    }
  }

  const id_Data = fields.indexOf("data");
  if (id_Data !== -1) {
    try {
      const dataRaw = fields[id_Data + 1];
      const dataObj = JSON.parse(dataRaw ?? "");
      // dataObj might itself be { kind, payload } or the raw payload for price-update
      if (typeof dataObj.kind === "string" && dataObj.payload !== undefined) {
        return { kind: dataObj.kind, payload: dataObj.payload };
      } else {
        // fallback: treat it as a price-update payload if shape matches
        return { kind: "price-update", payload: dataObj };
      }
    } catch (e) {
      console.error("failed parse data field", e);
      return {};
    }
  }

  return {};
}

async function handlePriceUpdate(payload: any) {
  // Normalize payload keys which your price-poller uses
  // Example payload shape from your price poller:
  // { symbol: "BTCUSDT", askPrice: number, bidPrice: number, decimal: 4, time: ... }
  // And your asset key mapping earlier used assets like "BTC" etc.
  const symbol = payload.symbol || payload.asset || payload.symbolName;
  if (!symbol) return;

  // choose the key you use in ORDER asset values; here I will assume ORDER.asset === payload.symbol OR short asset
  // If your pricePoller used full symbol (BTCUSDT) while ORDER.asset uses "BTC", map appropriately.
  // For now, store both: full symbol and short symbol when payload has both.
  const ask = Number(payload.askPrice ?? payload.ask ?? payload.askPriceValue);
  const bid = Number(payload.bidPrice ?? payload.bid ?? payload.bidPriceValue);

  if (Number.isNaN(ask) || Number.isNaN(bid)) return;

  // Update PRICESTORE using the symbol as provided
  PRICESTORE[symbol] = { ask, bid };

  //   // If you also want short symbol like BTC, derive it if possible
  //   // e.g., if symbol === "BTCUSDT" create shortSymbol = "BTC"
  //   let shortSymbol: string | undefined;
  //   const m = symbol.match(/^([A-Z]+)USDT$/);
  //   if (m) shortSymbol = m[1];

  //   if (shortSymbol) PRICESTORE[shortSymbol] = { ask, bid };

  // Check open orders for this asset (both symbol keys)
  try {
    await checkOpenOrders(symbol, { ask, bid });
    // if (shortSymbol) await checkOpenOrders(shortSymbol, { ask, bid });
  } catch (e) {
    console.error("error during checkOpenOrders:", e);
  }
}

async function handlePlaceTrade(payload: any) {
  // Ensure payload contains required fields
  const {
    orderId,
    userId,
    asset,
    type,
    margin,
    leverage,
    takeProfit,
    stopLoss,
    timestamp,
  } = payload;

  if (!orderId || !userId || !asset || !type) {
    await publishCallback({
      id: orderId || "unknown",
      status: "invalid_payload",
    });
    return;
  }

  // If there's no live price yet, notify and skip (API can retry)
  const price = PRICESTORE[asset];
  if (!price) {
    await publishCallback({
      id: orderId,
      status: "price_not_available",
    });
    return;
  }

  const openPrice = type === "buy" ? price.ask : price.bid;

  ORDER[orderId] = {
    userId,
    type,
    asset,
    margin,
    leverage,
    openPrice,
    timestamp: timestamp ?? Date.now(),
    takeProfit,
    stopLoss,
    liquidation: payload.liquidation,
  };

  await publishCallback({
    id: orderId,
    status: "trade_opened",
    openPrice: String(openPrice),
    takeProfit,
    stopLoss,
    liquidation: payload.liquidation ?? null,
    leverage,
    margin,
    asset,
    side: type,
  });
}

async function handleCloseTrade(payload: any) {
  const { orderId, userId } = payload;
  if (!orderId) {
    await publishCallback({
      id: "unknown",
      status: "invalid_order",
    });
    return;
  }

  // If order not present
  if (!ORDER[orderId]) {
    await publishCallback({
      id: orderId,
      status: "invalid_order",
    });
    return;
  }

  const order = ORDER[orderId];
  const price = PRICESTORE[order.asset];

  if (!price) {
    await publishCallback({
      id: orderId,
      status: "price_not_available",
    });
    return;
  }

  const closePrice = order.type === "buy" ? price.bid : price.ask;

  try {
    const pnl = await serviceCloseOrder(
      userId ?? order.userId,
      orderId,
      "manual",
      closePrice
    );

    await publishCallback({
      id: orderId,
      status: "trade_closed",
      pnl: String(pnl),
      closePrice: String(closePrice),
    });
  } catch (e) {
    console.error("error closing order:", e);
    await publishCallback({
      id: orderId,
      status: "close_error",
      err: String(e),
    });
  }
}

async function handleMessage(kind: string | undefined, payload: any) {
  if (!kind) {
    console.warn("message without kind received", payload);
    return;
  }

  switch (kind) {
    case "price-update":
      await handlePriceUpdate(payload);
      break;
    case "place-trade":
    case "place_trade":
      await handlePlaceTrade(payload);
      break;
    case "close-trade":
    case "close_trade":
      await handleCloseTrade(payload);
      break;
    default:
      console.warn("unknown kind:", kind, "payload:", payload);
  }
}

/**
 * Main loop: continuously XREAD BLOCK 0 engine-stream lastId
 * Keeps lastId so we don't reprocess.
 */
async function engineLoop() {
  // start from "$" so only new messages are read
  let lastId = "$";

  // reconnect loop
  while (true) {
    try {
      // xread will block until a message arrives
      const res = await reader.xread(
        "BLOCK",
        0,
        "STREAMS",
        "engine-stream",
        lastId
      );

      if (!res || !res.length) continue;

      // xread returns an array of [streamKey, [[id, [field, value, ...]], ...]]
      for (const [, messages] of res) {
        for (const [id, fields] of messages as [string, string[]][]) {
          lastId = id;

          const { kind, payload } = parseFields(fields);

          // process sequentially to maintain order. If you want parallel processing,
          // you can push to a worker pool here — but preserving order for price->trade is important.
          await handleMessage(kind, payload);
        }
      }
    } catch (err) {
      console.error("engine loop error, reconnecting in 1s", err);
      await new Promise((r) => setTimeout(r, 1000));
      try {
        if (reader.status !== "ready") await reader.connect();
        if (publisher.status !== "ready") await publisher.connect();
      } catch (e) {
        // swallow reconnect errors and loop
      }
    }
  }
}

async function start() {
  // connect both clients
  await reader.connect();
  await publisher.connect();

  console.log("Engine connected to Redis - starting loop");
  await engineLoop();
}

// graceful shutdown
process.on("SIGINT", async () => {
  console.log("SIGINT received: closing redis connections...");
  try {
    await reader.disconnect();
    await publisher.disconnect();
  } catch (e) {}
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received: closing redis connections...");
  try {
    await reader.disconnect();
    await publisher.disconnect();
  } catch (e) {}
  process.exit(0);
});

start().catch((e) => {
  console.error("engine start failed", e);
  process.exit(1);
});
