import { redis } from "@repo/redis/client";
import WebSocket from "ws";
import { toInternalPrice } from "./utils";

const symbolMap: Record<string, string> = {
    BTCUSDT: "BTC",
    ETHUSDT: "ETH",
    SOLUSDT: "SOL",
}

const pubClient = redis.duplicate();

async function main(){
     if (pubClient.status !== "ready" && pubClient.status !== "connecting") {
    await pubClient.connect();
    console.log("connected to Redis!");
  } else {
    console.log(`Redis already ${pubClient.status}`);
  }

    const ws = new WebSocket("wss://stream.binance.com:9443/ws");

    ws.on('open', () => {
        console.log('connected to binance ws api!');
        ws.send(
            JSON.stringify({
                method: "SUBSCRIBE",
                params: ["btcusdt@aggTrade", "ethusdt@aggTrade", "solusdt@aggTrade"],
                id: 1
            })
        );
    });

    ws.on('message', async (msg: string) => {
        const message = JSON.parse(msg) as {
            e: string;
            s: string;
            a: number | string;
            p: number | string;
            q: number | string;
            T: number | string;
            [key: string]: any;
        };
        // console.log(message);
        if(message.e === "aggTrade"){
            const ask = toInternalPrice(Number((Number(message.p) * 1.01).toFixed(2)));
            const bid = toInternalPrice(Number((Number(message.p)).toFixed(2)));

            const symbol = symbolMap[message.s];

            if(!symbol) return;

            const data = {
                  symbol: symbol,
                  askPrice: ask,
                  bidPrice: bid,
                  decimal: 4,
                  time: Math.floor(new Date(message.T).getTime() / 1000)
            }

            await pubClient.publish(symbol, JSON.stringify(data));

          await redis.xadd(
           "engine-stream",
           "*",
           "data",
           JSON.stringify({ kind: "price-update", payload: data })
         );
        }
    });

    ws.on('error', (e) => {
        console.log("error from the websocket" + e);
    });

    ws.on('close', () => {
        console.log('websocket connection closed');
    });
}

process.on("SIGINT", async () => {
  console.log("SIGINT received: closing Redis connections...");
  try {
    await pubClient.quit();
    await redis.quit();
  } catch (e) {
    console.error("Error while closing redis:", e);
  } finally {
    process.exit(0);
  }
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received: closing Redis connections...");
  try {
    await pubClient.quit();
    await redis.quit();
  } catch (e) {
    console.error("Error while closing redis:", e);
  } finally {
    process.exit(0);
  }
});

main();