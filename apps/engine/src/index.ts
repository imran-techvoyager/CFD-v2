import { redis } from "@repo/redis/client";
import { checkOpenOrders } from "./service/checkOrders";
import { closeOrder } from "./service/closeOrder";
import { ORDER, PRICESTORE } from "./state";
import type { CloseOrderReason } from "./types/types";

/**
 * Helper: Send callback response back to backend
 */
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
 * Stream reader loop
 */
async function startEngineStream() {
  console.log("[ENGINE] Listening on engine-stream...");
  let lastId = "$"; // only new messages

  while (true) {
    try {
      const res = await redis.xread(
        "BLOCK",
        0,
        "STREAMS",
        "engine-stream",
        lastId
      );

      // type guard to avoid TS2488
      if (!res || !Array.isArray(res) || res.length === 0) continue;

      const stream = res[0];
      if (!stream) continue;

      const messages = stream[1];
      if (!messages || messages.length === 0) continue;

      for (const [id, rawFields] of messages) {
        if (!rawFields) continue; // safety guard
        lastId = id;

        const fields = rawFields as string[]; // assert type
        const obj: Record<string, string> = {};

        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          const value = fields[i + 1];
          if (key !== undefined && value !== undefined) {
            obj[key] = value;
          }
        }

        await handleStreamMessage(obj);
      }
    } catch (err) {
      console.error("[ENGINE] Stream read error:", err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log("[ENGINE] Shutting down...");
  try {
    await redis.quit();
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
  // await redis.connect();
  console.log("[ENGINE] Connected to Redis!");
  startEngineStream();
}

main().catch((err) => console.error("[ENGINE] Failed to start:", err));
