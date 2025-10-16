// apps/backend/utils/redisSubscriber.ts
import Redis from "ioredis";

export const CALLBACK_QUEUE = "callback-queue";

// Define the shape of your callback data
export interface CallbackData {
  id?: string;
  status?: string;
  asset?: string;
  side?: string;
  openPrice?: string;
  takeProfit?: string;
  stopLoss?: string;
  liquidation?: string;
  leverage?: string;
  margin?: string;
  [key: string]: string | undefined;
}

export class RedisSubscriber {
  private client: Redis;
  private callbacks: Record<string, (data: CallbackData) => void>;

  constructor() {
    this.client = new Redis("redis://localhost:6379");
    this.callbacks = {};
    this.listenForMessages();
  }

  private async listenForMessages() {
  let lastId = "0"; // Start from beginning once

  while (true) {
    try {
      const response = await this.client.xread(
        "BLOCK",
        0,
        "STREAMS",
        CALLBACK_QUEUE,
        lastId
      );

      if (!response?.length) continue;

      const [, messages] = response[0]!;
      for (const [id, fields] of messages) {
        lastId = id; // Remember latest message ID

        const data: CallbackData = {};
        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i]!;
          const value = fields[i + 1]!;
          data[key] = value;
        }

        const callbackId = data.id;
        if (callbackId && this.callbacks[callbackId]) {
          console.log(`[RedisSubscriber] Resolving callback for ID: ${callbackId}`);
          this.callbacks[callbackId](data);
          delete this.callbacks[callbackId];
        }
      }
    } catch (err) {
      console.error("[RedisSubscriber] Error in listener:", err);
    }
  }
}


  async waitForMessage(id: string, timeout = 7000): Promise<CallbackData> {
    return new Promise((resolve, reject) => {
      this.callbacks[id] = (data: CallbackData) => resolve(data);
      setTimeout(() => {
        if (this.callbacks[id]) {
          delete this.callbacks[id];
          reject(new Error(`Timeout waiting for callback: ${id}`));
        }
      }, timeout);
    });
  }
}
