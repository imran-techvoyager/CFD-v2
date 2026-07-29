import { redis, createRedis } from "@repo/redis/client";
import {
  COMMAND_TTL_MS,
  STREAMS,
  compareStreamIds,
  engineStreamMessageSchema,
  type EngineCommand,
} from "@repo/shared";
import { checkOpenOrders } from "./service/checkOrders";
import { closeOrder, partialCloseOrder } from "./service/closeOrder";
import { modifyOrder } from "./service/modifyOrder";
import { openOrder } from "./service/openOrder";
import { ORDER, PRICESTORE } from "./state";
import { saveSnapshot, restoreState } from "./service/snapshots";

const STREAM_MAXLEN = 100_000;

let CURRENT_STREAM_ID = "$";
let subRedis: ReturnType<typeof createRedis> | null = null;
let shuttingDown = false;

// ------------------------------------------------------------ instrumentation

const stats = { messages: 0, totalUs: 0, maxUs: 0 };

function recordLatency(startNs: bigint) {
  const us = Number(process.hrtime.bigint() - startNs) / 1000;
  stats.messages++;
  stats.totalUs += us;
  if (us > stats.maxUs) stats.maxUs = us;
}

setInterval(() => {
  if (stats.messages === 0) return;
  console.log(
    `[ENGINE] ${stats.messages} msgs/min | avg ${(stats.totalUs / stats.messages).toFixed(0)}µs | max ${stats.maxUs.toFixed(0)}µs | ${Object.keys(ORDER).length} open orders`
  );
  stats.messages = 0;
  stats.totalUs = 0;
  stats.maxUs = 0;
}, 60_000).unref();

// ------------------------------------------------------------------ callbacks

async function sendCallback(id: string, payload: Record<string, unknown>) {
  const flat: string[] = ["id", id];
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) continue;
    flat.push(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  try {
    await redis.xadd(STREAMS.CALLBACKS, "MAXLEN", "~", 10_000, "*", ...flat);
  } catch (err) {
    console.error(`[ENGINE] Failed to push callback for ${id}`, err);
  }
}

// ------------------------------------------------------------------- handlers

async function handleCommand(msg: EngineCommand, replay: boolean) {
  const { id, request } = msg;

  try {
    switch (request.kind) {
      case "place-trade": {
        const result = await openOrder(request.payload, { replay });

        if (!result.ok) {
          await sendCallback(id, { status: "error", msg: result.error });
          return;
        }

        await sendCallback(id, {
          status: "opened",
          asset: request.payload.asset,
          side: request.payload.type,
          openPrice: result.openPrice,
          takeProfit: request.payload.takeProfit,
          stopLoss: request.payload.stopLoss,
          liquidation: result.liquidation,
          leverage: request.payload.leverage,
          margin: result.margin,
          volume: request.payload.volume,
        });
        return;
      }

      case "close-trade": {
        const { orderId, userId, volume } = request.payload;

        const order = ORDER[orderId];
        // ownership check: a foreign orderId is indistinguishable from a
        // missing one on purpose (no order-existence oracle)
        if (!order || order.userId !== userId) {
          await sendCallback(id, { status: "error", msg: "order-not-found" });
          return;
        }

        const priceData = PRICESTORE[order.asset];
        if (!priceData) {
          await sendCallback(id, { status: "error", msg: "no-price-available" });
          return;
        }

        const price = order.type === "buy" ? priceData.bid : priceData.ask;

        // partial close: anything below the order's volume; a leftover
        // smaller than 0.01 lot would be unclosable dust, so full-close then
        const isPartial = volume !== undefined && volume < order.volume && order.volume - volume >= 1;

        const pnl = isPartial
          ? await partialCloseOrder(id, orderId, volume, price)
          : await closeOrder(orderId, "manual", price);

        await sendCallback(id, {
          status: "closed",
          asset: order.asset,
          side: order.type,
          closePrice: price,
          pnl: pnl ?? 0,
          partial: isPartial,
          remainingVolume: isPartial ? order.volume : 0,
        });
        return;
      }

      case "modify-trade": {
        const result = await modifyOrder(request.payload);
        if (!result.ok) {
          await sendCallback(id, { status: "error", msg: result.error });
          return;
        }
        await sendCallback(id, {
          status: "modified",
          takeProfit: result.takeProfit,
          stopLoss: result.stopLoss,
        });
        return;
      }

      case "get-open-orders": {
        const { userId } = request.payload;
        const orders = Object.entries(ORDER)
          .filter(([, o]) => o.userId === userId)
          .map(([orderId, o]) => ({
            orderId,
            asset: o.asset,
            type: o.type,
            margin: o.margin,
            volume: o.volume,
            leverage: o.leverage,
            openPrice: o.openPrice,
            takeProfit: o.takeProfit,
            stopLoss: o.stopLoss,
            liquidation: o.liquidation,
            timestamp: o.timestamp,
          }));

        await sendCallback(id, { status: "ok", orders: JSON.stringify(orders) });
        return;
      }
    }
  } catch (err) {
    console.error(`[ENGINE] Failed to process command ${id}:`, err);
    await sendCallback(id, { status: "error", msg: "engine-error" });
  }
}

async function handleStreamMessage(raw: Record<string, string>, replay: boolean) {
  if (!raw.data) return;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.data);
  } catch {
    console.error("[ENGINE] Dropping non-JSON stream message");
    return;
  }

  // validate at the boundary — a malformed producer can never half-execute
  const parsed = engineStreamMessageSchema.safeParse(parsedJson);
  if (!parsed.success) {
    console.error("[ENGINE] Dropping malformed stream message:", parsed.error.issues[0]?.message);
    return;
  }
  const msg = parsed.data;

  if ("kind" in msg) {
    // price update
    const { symbol, askPrice, bidPrice } = msg.payload;
    PRICESTORE[symbol] = { ask: askPrice, bid: bidPrice, updatedAt: Date.now() };
    await checkOpenOrders(symbol, PRICESTORE[symbol]);
    return;
  }

  await handleCommand(msg, replay);
}

// ---------------------------------------------------------------- stream loop

async function streamTip(client: ReturnType<typeof createRedis>): Promise<string> {
  try {
    const latest = await client.xrevrange(STREAMS.ENGINE, "+", "-", "COUNT", 1);
    return latest.length ? latest[0]![0] : "0-0";
  } catch {
    return "0-0";
  }
}

async function startEngineStream(initialId: string) {
  subRedis = createRedis();
  let lastId = initialId;

  // resolve "$" to the concrete tip so nothing slips between blocking reads
  if (lastId === "$") lastId = await streamTip(subRedis);

  // everything at-or-before the tip existing at boot is a replay of messages
  // we may have already (partially) executed before a crash
  const replayBoundary = await streamTip(subRedis);

  console.log(
    `[ENGINE] Listening on ${STREAMS.ENGINE} from ${lastId} (replay boundary ${replayBoundary})...`
  );

  try {
    while (!shuttingDown) {
      const res = await subRedis.xread("BLOCK", 5000, "STREAMS", STREAMS.ENGINE, lastId);

      if (!res || !Array.isArray(res) || res.length === 0) continue;
      const [, messages] = res[0]!;
      if (!messages || messages.length === 0) continue;

      for (const [id, rawFields] of messages) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < rawFields.length; i += 2) {
          obj[rawFields[i]!] = rawFields[i + 1]!;
        }

        const startNs = process.hrtime.bigint();
        const replay = compareStreamIds(id, replayBoundary) <= 0;
        await handleStreamMessage(obj, replay);
        recordLatency(startNs);

        // advance the cursor only after the message is fully processed, so a
        // crash mid-message replays it (all handlers are idempotent)
        CURRENT_STREAM_ID = id;
        lastId = id;
      }
    }
  } catch (err) {
    if (!shuttingDown) {
      console.error("[ENGINE] Stream read error, restarting loop in 1s:", err);
      setTimeout(() => startEngineStream(lastId), 1000);
      return;
    }
  } finally {
    if (shuttingDown) {
      console.log("[ENGINE] Stream loop exited.");
      subRedis?.disconnect();
    }
  }
}

// ------------------------------------------------------------------- lifecycle

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[ENGINE] Shutting down...");
  try {
    await saveSnapshot(CURRENT_STREAM_ID);
    subRedis?.disconnect();
    await redis.quit();
    console.log("[ENGINE] Snapshot saved, Redis closed.");
  } catch (err) {
    console.error("[ENGINE] Error during shutdown:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  console.log("[ENGINE] Booting up...");
  console.log(`[ENGINE] Command TTL ${COMMAND_TTL_MS}ms; single-writer event loop`);

  const restoredStreamId = await restoreState();
  let lastId = restoredStreamId ?? "$";

  if (!/^\d+-\d+$/.test(lastId) && lastId !== "$") {
    console.warn(`[ENGINE] Invalid lastId '${lastId}', resetting to "$"`);
    lastId = "$";
  }

  startEngineStream(lastId);

  // snapshot the stream cursor every 30s; trim the stream every 5min
  let isSavingSnapshot = false;
  setInterval(async () => {
    if (isSavingSnapshot) return;
    isSavingSnapshot = true;
    try {
      await saveSnapshot(CURRENT_STREAM_ID);
    } finally {
      isSavingSnapshot = false;
    }
  }, 30_000);

  setInterval(() => {
    redis
      .xtrim(STREAMS.ENGINE, "MAXLEN", "~", STREAM_MAXLEN)
      .catch((err) => console.error("[ENGINE] xtrim failed:", err));
  }, 300_000);
}

main().catch((err) => {
  console.error("[ENGINE] Failed to start:", err);
  process.exit(1);
});
