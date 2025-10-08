import WebSocket, { WebSocketServer } from "ws";
import { redis } from "@repo/redis/client";

const subClient = redis.duplicate();
const client = new Map<WebSocket, Set<string>>();
const channels = ["BTC", "ETH", "SOL"];

const wss = new WebSocketServer({ port: 8080 });

async function start() {
  await subClient.connect();

  channels.forEach((ch) => {
    redis.subscribe(ch, (msg) => {
      client.forEach((symbs, ws: WebSocket) => {
        if (symbs.has(ch)) {
          ws.send(msg);
        }
      });
    });
  });

  wss.on("connection", (socket: WebSocket) => {
    client.set(socket, new Set());

    socket.on("message", (msg) => {
      const message = JSON.parse(msg.toString());
      if (message.type === "SUBSCRIBE") {
        if (!client.has(socket)) {
          client.set(socket, new Set());
        }

        const symbs = client.get(socket);
        symbs?.add(message.symbol);
      }

      if (message.type === "UNSUBSCRIBE") {
        const symbs = client.get(socket);
        symbs?.delete(message.symbol);
        if (symbs?.size === 0) {
          client.delete(socket);
        }
      }
    });
  });
}

start().catch(console.error);
