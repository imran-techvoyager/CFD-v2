import WebSocket, { WebSocketServer } from "ws";
import { redis } from "@repo/redis/client";

const subClient = redis.duplicate();
const clients = new Map<WebSocket, Set<string>>();
const channels = ["BTC", "ETH", "SOL"];

const wss = new WebSocketServer({ port: 8080 });

async function start() {
  await subClient.connect();

  await subClient.subscribe(...channels);

  subClient.on("message", (channel, message) => {
    clients.forEach((symbs, ws: WebSocket) => {
        if(symbs.has(channel)){
            ws.send(message);
        }
    });
  });

  wss.on("connection", (socket: WebSocket) => {
    clients.set(socket, new Set());

    socket.on("message", (msg) => {
      const message = JSON.parse(msg.toString());
      if (message.type === "SUBSCRIBE") {
        if (!clients.has(socket)) {
          clients.set(socket, new Set());
        }

        const symbs = clients.get(socket);
        symbs?.add(message.symbol);
      }

      if (message.type === "UNSUBSCRIBE") {
        const symbs = clients.get(socket);
        symbs?.delete(message.symbol);
        if (symbs?.size === 0) {
          clients.delete(socket);
        }
      }
    });
  });
}

process.on("SIGINT", async () => {
  console.log("SIGINT received: closing Redis connections...");
  try {
    await subClient.quit();
    await redis.quit();
  } catch (e) {}
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received: closing Redis connections...");
  try {
    await subClient.quit();
    await redis.quit();
  } catch (e) {}
  process.exit(0);
});


start().catch(console.error);
