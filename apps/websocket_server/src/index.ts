import WebSocket, { WebSocketServer } from "ws";
import { createRedis } from "@repo/redis/client";
import jwt from "jsonwebtoken";

const PRICE_CHANNELS = ["BTC", "ETH", "SOL"];
const ORDER_EVENTS_CHANNEL = "order-events";
const PORT = Number(process.env.WS_PORT) || 8080;
const JWT_SECRET = process.env.JWT_PASSWORD || "dev-jwt-secret-change-in-prod";

interface ClientState {
  symbols: Set<string>;
  userId: string | null;
  alive: boolean;
}

const subClient = createRedis();
const clients = new Map<WebSocket, ClientState>();

const wss = new WebSocketServer({ port: PORT });

async function start() {
  await subClient.subscribe(...PRICE_CHANNELS, ORDER_EVENTS_CHANNEL);

  subClient.on("message", (channel, message) => {
    if (channel === ORDER_EVENTS_CHANNEL) {
      let event: any;
      try {
        event = JSON.parse(message);
      } catch {
        return;
      }
      const wrapped = JSON.stringify({ type: "order-event", ...event });
      clients.forEach((state, ws) => {
        if (state.userId && state.userId === event.userId && ws.readyState === WebSocket.OPEN) {
          ws.send(wrapped);
        }
      });
      return;
    }

    // price tick — fan out to subscribers of that symbol
    clients.forEach((state, ws) => {
      if (state.symbols.has(channel) && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });

  wss.on("connection", (socket: WebSocket) => {
    clients.set(socket, { symbols: new Set(), userId: null, alive: true });

    socket.on("pong", () => {
      const state = clients.get(socket);
      if (state) state.alive = true;
    });

    socket.on("message", (msg) => {
      let message: any;
      try {
        message = JSON.parse(msg.toString());
      } catch {
        return;
      }

      const state = clients.get(socket);
      if (!state) return;

      if (message.type === "SUBSCRIBE" && typeof message.symbol === "string") {
        if (PRICE_CHANNELS.includes(message.symbol)) {
          state.symbols.add(message.symbol);
        }
      }

      if (message.type === "UNSUBSCRIBE" && typeof message.symbol === "string") {
        state.symbols.delete(message.symbol);
      }

      // authenticate to receive personal order events (fills, liquidations…)
      if (message.type === "AUTH" && typeof message.token === "string") {
        try {
          const decoded = jwt.verify(message.token, JWT_SECRET) as { id: string };
          state.userId = decoded.id;
          socket.send(JSON.stringify({ type: "AUTH_OK" }));
        } catch {
          socket.send(JSON.stringify({ type: "AUTH_FAILED" }));
        }
      }
    });

    socket.on("close", () => {
      clients.delete(socket);
    });

    socket.on("error", () => {
      clients.delete(socket);
      socket.terminate();
    });
  });

  // heartbeat: drop dead connections
  setInterval(() => {
    clients.forEach((state, ws) => {
      if (!state.alive) {
        clients.delete(ws);
        ws.terminate();
        return;
      }
      state.alive = false;
      ws.ping();
    });
  }, 30_000);

  console.log(`[WS] websocket server listening on :${PORT}`);
}

async function shutdown(signal: string) {
  console.log(`${signal} received: closing...`);
  try {
    wss.close();
    await subClient.quit();
  } catch (e) {}
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((err) => {
  console.error("[WS] failed to start:", err);
  process.exit(1);
});
