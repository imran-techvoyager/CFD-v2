import { redis } from "@repo/redis/client";
import prismaClient from "@repo/db/client";
import { checkOpenOrders } from "./service/checkOrders";
import { closeOrder as serviceCloseOrder } from "./service/closeOrder";
import { createSnapshot } from "./service/snapshot";
import { getLastStreamId, setLastStreamId } from "./service/streamState";

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

  const symbol = payload.symbol || payload.asset || payload.symbolName;
  if (!symbol) return;

  const ask = Number(payload.askPrice ?? payload.ask ?? payload.askPriceValue);
  const bid = Number(payload.bidPrice ?? payload.bid ?? payload.bidPriceValue);

  if (Number.isNaN(ask) || Number.isNaN(bid)) return;

  // Update PRICESTORE using the symbol as provided
  PRICESTORE[symbol] = { ask, bid };

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
async function replayMissedMessages(lastStreamId: string) {
  console.log(
    `[ENGINE] Replaying missed messages since stream ID: ${lastStreamId}`
  );

  let replayId = lastStreamId;

  while (true) {
    const res = await reader.xread(
      "COUNT",
      100,
      "STREAMS",
      "engine-stream",
      replayId
    );
    if (!res || !res.length) break;

    let processed = 0;

    for (const [, messages] of res) {
      for (const [id, fields] of messages as [string, string[]][]) {
        const { kind, payload } = parseFields(fields);
        await handleMessage(kind, payload);
        setLastStreamId(id);
        replayId = id;
        processed++;
      }
    }

    if (processed === 0) break;
  }

  console.log("[ENGINE] Replay completed — switching to live mode.");
}

export async function engineLoop() {
  if (reader.status !== "ready" && reader.status !== "connecting") {
    await reader.connect();
  }

  // Step 1: Load last snapshot to get lastStreamId
  const lastSnapshot = await prismaClient.engineSnapshot.findFirst({
    orderBy: { timestamp: "desc" },
  });

  let startFromId = "$";

  if (lastSnapshot?.lastStreamId) {
    startFromId = lastSnapshot.lastStreamId;
    await replayMissedMessages(startFromId);
  }

  // Step 2: Enter live mode
  console.log("[ENGINE] Live mode started...");

  while (true) {
    try {
      const res = await reader.xread(
        "BLOCK",
        0,
        "STREAMS",
        "engine-stream",
        getLastStreamId()
      );

      console.log("[ENGINE DEBUG] XREAD result:", JSON.stringify(res, null, 2));
      
      if (!res || !res.length) continue;

      for (const [, messages] of res) {
        for (const [id, fields] of messages as [string, string[]][]) {
          const { kind, payload } = parseFields(fields);
          await handleMessage(kind, payload);
          setLastStreamId(id);
        }
      }
    } catch (err) {
      console.error("[ENGINE] Loop error, waiting to reconnect...", err);
      await new Promise((r) => setTimeout(r, 1000));
      try {
        if (reader.status === "end" || reader.status === "wait") {
          await reader.connect();
          console.log("[ENGINE] Reader reconnected");
        }
      } catch (e) {
        console.error("[ENGINE] Reconnect failed:", e);
      }
    }
  }
}

async function restoreLastSnapshot() {
  try {
    const latest = await prismaClient.engineSnapshot.findFirst({
      orderBy: { timestamp: "desc" },
    });

    if (!latest) {
      console.log("[SNAPSHOT] No snapshot found, starting fresh.");
      return;
    }

    Object.assign(ORDER, latest.openOrders || {});
    Object.assign(PRICESTORE, latest.priceStore || {});

    console.log(`[SNAPSHOT] Restored engine state from ${latest.timestamp}`);
  } catch (e) {
    console.error("[SNAPSHOT RESTORE ERROR]", e);
  }
}

async function start() {
  // connect both clients
  if (reader.status !== "ready" && reader.status !== "connecting") {
    await reader.connect();
  }
  if (publisher.status !== "ready" && publisher.status !== "connecting") {
    await publisher.connect();
  }

  await restoreLastSnapshot();

  setInterval(createSnapshot, 10_000);

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
