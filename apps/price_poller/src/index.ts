import { redis, createRedis } from "@repo/redis/client";
import WebSocket from "ws";
import { STREAMS, toInternalPrice, type Asset } from "@repo/shared";

const symbolMap: Record<string, Asset> = {
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  SOLUSDT: "SOL",
};

// half-spread in basis points applied around the traded price
// (total spread = 5 bps, in the same ballpark as a tight CFD broker)
const HALF_SPREAD_BPS = 2.5;

// don't publish the same symbol more often than this
const THROTTLE_MS = 100;

const STREAM_MAXLEN = 100_000;

const pubClient = createRedis();
const lastPublished: Record<string, number> = {};

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let shuttingDown = false;

function connect() {
  if (shuttingDown) return;

  const streams = Object.keys(symbolMap)
    .map((s) => `${s.toLowerCase()}@aggTrade`)
    .join("/");

  ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

  ws.on("open", () => {
    console.log("[POLLER] connected to Binance stream");
    reconnectDelay = 1000;
  });

  ws.on("message", async (raw: Buffer) => {
    let message: any;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const trade = message?.data;
    if (!trade || trade.e !== "aggTrade") return;

    const symbol = symbolMap[trade.s];
    if (!symbol) return;

    const now = Date.now();
    if (now - (lastPublished[symbol] ?? 0) < THROTTLE_MS) return;
    lastPublished[symbol] = now;

    const price = Number(trade.p);
    if (!Number.isFinite(price) || price <= 0) return;

    const ask = toInternalPrice(price * (1 + HALF_SPREAD_BPS / 10_000));
    const bid = toInternalPrice(price * (1 - HALF_SPREAD_BPS / 10_000));

    const data = {
      symbol,
      askPrice: ask,
      bidPrice: bid,
      decimal: 4,
      time: Math.floor(Number(trade.T) / 1000),
    };

    try {
      await Promise.all([
        pubClient.publish(symbol, JSON.stringify(data)),
        redis.xadd(
          STREAMS.ENGINE,
          "MAXLEN",
          "~",
          STREAM_MAXLEN,
          "*",
          "data",
          JSON.stringify({ kind: "price-update", payload: data })
        ),
      ]);
    } catch (err) {
      console.error("[POLLER] failed to publish price:", err);
    }
  });

  ws.on("error", (e) => {
    console.error("[POLLER] websocket error:", e.message);
  });

  ws.on("close", () => {
    if (shuttingDown) return;
    console.log(`[POLLER] connection closed, reconnecting in ${reconnectDelay}ms`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  });

  // Binance sends pings and expects pongs; ws lib answers automatically.
  // Guard against silent stalls: if no message for 60s, force reconnect.
  let lastMessageAt = Date.now();
  ws.on("message", () => (lastMessageAt = Date.now()));
  const staleCheck = setInterval(() => {
    if (Date.now() - lastMessageAt > 60_000) {
      console.warn("[POLLER] stream stale, forcing reconnect");
      clearInterval(staleCheck);
      ws?.terminate();
    }
  }, 15_000);
  ws.on("close", () => clearInterval(staleCheck));
}

async function shutdown(signal: string) {
  console.log(`${signal} received: closing...`);
  shuttingDown = true;
  try {
    ws?.terminate();
    await pubClient.quit();
    await redis.quit();
  } catch (e) {
    console.error("Error while closing redis:", e);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

connect();
