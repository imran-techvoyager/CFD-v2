import { redis } from "@repo/redis/client";
import { checkOpenOrders } from "./service/checkOrders";
import { closeOrder } from "./service/closeOrder";
import { ORDER, PRICESTORE } from "./state";
import type { CloseOrderReason } from "./types/types";
import prismaClient from "@repo/db/client";
import { saveSnapshot } from "./service/snapshots";

/**
 * Helper: Send callback response back to backend
 */

let CURRENT_STREAM_ID = "$";
let subRedis: any = null;
let shuttingDown = false;

async function sendCallbackToQueue(id: string, payload: Record<string, any>) {
  const flat: string[] = ["id", id];
  for (const [k, v] of Object.entries(payload)) {
    flat.push(k, v == null ? "" : String(v));
  }
  try {
    await redis.xadd("callback-queue", "*", ...flat);
    console.log(`[ENGINE] Callback -> ${id}`, payload);
  } catch (err) {
    console.error(`[ENGINE] Failed to push callback for ${id}`, err);
  }
}

/**
 * Handle stream message logic
 */
async function handleStreamMessage(raw: Record<string, string>) {
  try {
    if (!raw.data) return;
    const msg = JSON.parse(raw.data);

    // ----------------- PRICE UPDATE -----------------
    if (msg.kind === "price-update") {
      const { symbol, askPrice, bidPrice } = msg.payload;
      if (!symbol) return;

      PRICESTORE[symbol] = { ask: Number(askPrice), bid: Number(bidPrice) };
      await checkOpenOrders(symbol, PRICESTORE[symbol]);
      return;
    }

    // ----------------- PLACE TRADE -----------------
    if (msg.request && msg.id && msg.request.kind === "place-trade") {
      const id: string = msg.id;
      const data = msg.request.payload;
      const { userId, asset, type, margin, leverage, takeProfit, stopLoss } =
        data;

      const priceData = PRICESTORE[asset];
      if (!priceData) {
        await sendCallbackToQueue(id, {
          status: "error",
          msg: "no-price-available",
        });
        return;
      }

      const openPrice = type === "buy" ? priceData.ask : priceData.bid;

      ORDER[id] = {
        userId,
        type,
        asset,
        margin,
        leverage,
        openPrice,
        timestamp: Date.now(),
        takeProfit,
        stopLoss,
      };

      console.log(`[ENGINE] Order opened ${id} on ${asset} @ ${openPrice}`);

      await sendCallbackToQueue(id, {
        status: "opened",
        asset,
        side: type,
        openPrice,
        takeProfit,
        stopLoss,
        liquidation: "false",
        leverage,
        margin,
      });
      return;
    }

    // ----------------- CLOSE TRADE -----------------
    if (msg.request && msg.id && msg.request.kind === "close-trade") {
      const id: string = msg.id;
      const data = msg.request.payload;
      const { orderId, userId } = data;

      const order = ORDER[orderId];
      if (!order) {
        await sendCallbackToQueue(id, {
          status: "error",
          msg: "order-not-found",
        });
        return;
      }

      const priceData = PRICESTORE[order.asset];
      if (!priceData) {
        await sendCallbackToQueue(id, {
          status: "error",
          msg: "no-price-available",
        });
        return;
      }

      const price = order.type === "buy" ? priceData.bid : priceData.ask;

      // Explicit cast: ensure we match your CloseOrderReason type
      const reason: CloseOrderReason = "manual" as CloseOrderReason;

      const pnl = await closeOrder(userId, orderId, reason, price);

      await sendCallbackToQueue(id, {
        status: "closed",
        asset: order.asset,
        side: order.type,
        closePrice: price,
        pnl,
      });

      console.log(`[ENGINE] Closed order ${orderId} manually by user`);
      return;
    }
  } catch (err) {
    console.error("[ENGINE] Failed to process message:", err);
  }
}

/**
 * Restore the latest engine snapshot from DB
 */
export async function restoreSnapshot(): Promise<string | null> {
  try {
    const latest = await prismaClient.engineSnapshot.findFirst({
      orderBy: { timestamp: "desc" },
    });

    if (!latest) {
      console.log("[SNAPSHOT] No snapshot found, starting fresh.");
      return null;
    }

    Object.assign(ORDER, latest.openOrders || {});
    Object.assign(PRICESTORE, latest.priceStore || {});

    console.log(`[SNAPSHOT] Restored snapshot from ${latest.timestamp}`);
    return latest.lastStreamId || null;
  } catch (err) {
    console.error("[SNAPSHOT] Failed to restore snapshot:", err);
    return null;
  }
}

/**
 * Stream reader loop
 */
async function startEngineStream(initialId = "$") {
  console.log("[ENGINE] Listening on engine-stream...");

  subRedis = redis.duplicate();
  if (subRedis.status === "end" || subRedis.status === "wait") {
    await subRedis.connect();
  }

  let lastId = initialId;

  try {
    while (!shuttingDown) {
      const res = await subRedis.xread(
        "BLOCK",
        0,
        "STREAMS",
        "engine-stream",
        lastId
      );

      if (!res || !Array.isArray(res) || res.length === 0) continue;
      const [streamName, messages] = res[0];
      if (!messages || messages.length === 0) continue;

      for (const [id, rawFields] of messages) {
        CURRENT_STREAM_ID = id;  // track for snapshot
        lastId = id;             // ✅ advance so we don’t replay same message

        const obj: Record<string, string> = {};
        for (let i = 0; i < rawFields.length; i += 2) {
          obj[rawFields[i]] = rawFields[i + 1];
        }

        await handleStreamMessage(obj);
      }
    }
  } catch (err) {
    if (!shuttingDown) console.error("[ENGINE] Stream read error:", err);
  } finally {
    console.log("[ENGINE] Stream loop exited.");
    await subRedis.disconnect();
  }
}


/**
 * Graceful shutdown
 */
async function shutdown() {
  if (shuttingDown) return;  //prevent multiple calls
  shuttingDown = true;
  console.log("[ENGINE] Shutting down...");
  try {
    await saveSnapshot(CURRENT_STREAM_ID);
    if (subRedis) await subRedis.disconnect(); //instant break BLOCK
    await redis.quit();
    console.log("[ENGINE] Redis connections closed and snapshot saved.");
  } catch (err) {
    console.error("[ENGINE] Error during shutdown:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/**
 * Boot
 */
async function main() {
  console.log("[ENGINE] Booting up...");

  if (redis.status === "end" || redis.status === "wait") {
    await redis.connect();
  }
  console.log("[ENGINE] Connected to Redis!");

  // 🔄 Restore state
  const restoredStreamId = await restoreSnapshot();
  let lastId = "$";

  if (restoredStreamId && restoredStreamId !== "$") {
    const [ms, seq] = restoredStreamId.split("-");
    const nextSeq = Number(seq || 0) + 1;
    lastId = `${ms}-${nextSeq}`;
  }

  // sanity check
  if (!/^\d+-\d+$/.test(lastId) && lastId !== "$") {
    console.warn(`[ENGINE] Invalid lastId '${lastId}', resetting to "$"`);
    lastId = "$";
  }

  console.log(`[ENGINE] Starting from stream ID: ${lastId}`);

  startEngineStream(lastId);

  // 🕒 Schedule snapshots every minute
  let isSavingSnapshot = false;
  setInterval(async () => {
    if (isSavingSnapshot) return;
    isSavingSnapshot = true;
    await saveSnapshot(CURRENT_STREAM_ID);
    isSavingSnapshot = false;
  }, 60_000);
}

main().catch((err) => console.error("[ENGINE] Failed to start:", err));
