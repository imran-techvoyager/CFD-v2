// apps/backend/utils/redisSubscriber.ts
import { createRedis } from "@repo/redis/client";
import { STREAMS } from "@repo/shared";

const CALLBACK_QUEUE = STREAMS.CALLBACKS;

export interface CallbackData {
  id?: string;
  status?: string;
  msg?: string;
  asset?: string;
  side?: string;
  openPrice?: string;
  closePrice?: string;
  pnl?: string;
  takeProfit?: string;
  stopLoss?: string;
  liquidation?: string;
  leverage?: string;
  margin?: string;
  orders?: string;
  [key: string]: string | undefined;
}

export class RedisSubscriber {
  private client = createRedis();
  private callbacks: Record<string, (data: CallbackData) => void> = {};

  constructor() {
    this.listenForMessages();
  }

  private async listenForMessages() {
    // Start from the current tip of the stream (old callbacks are for
    // requests nobody is waiting on anymore). Using a concrete id instead of
    // "$" avoids the gap between blocking reads where messages could slip by.
    let lastId = "0-0";
    try {
      const latest = await this.client.xrevrange(CALLBACK_QUEUE, "+", "-", "COUNT", 1);
      if (latest.length) lastId = latest[0]![0];
    } catch (err) {
      console.error("[RedisSubscriber] failed to resolve stream tip:", err);
    }

    while (true) {
      try {
        const response = await this.client.xread(
          "BLOCK",
          5000,
          "STREAMS",
          CALLBACK_QUEUE,
          lastId
        );

        if (!response?.length) continue;

        const [, messages] = response[0]!;
        for (const [id, fields] of messages) {
          lastId = id;

          const data: CallbackData = {};
          for (let i = 0; i < fields.length; i += 2) {
            data[fields[i]!] = fields[i + 1]!;
          }

          const callbackId = data.id;
          if (callbackId && this.callbacks[callbackId]) {
            this.callbacks[callbackId](data);
            delete this.callbacks[callbackId];
          }
        }
      } catch (err) {
        console.error("[RedisSubscriber] Error in listener:", err);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async waitForMessage(id: string, timeout = 7000): Promise<CallbackData> {
    return new Promise((resolve, reject) => {
      this.callbacks[id] = resolve;
      setTimeout(() => {
        if (this.callbacks[id]) {
          delete this.callbacks[id];
          reject(new Error(`Timeout waiting for callback: ${id}`));
        }
      }, timeout);
    });
  }
}
