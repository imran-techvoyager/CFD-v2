import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});

redis.on("error", (err) => {
  console.error("[REDIS] connection error:", err.message);
});

export function createRedis(): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  client.on("error", (err) => {
    console.error("[REDIS] connection error:", err.message);
  });
  return client;
}
