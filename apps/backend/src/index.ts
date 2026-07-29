import express from "express";
import cors from "cors";
import prismaClient from "@repo/db/client";
import { redis } from "@repo/redis/client";
import { router } from "./routes";

const app = express();
const PORT = Number(process.env.HTTP_PORT) || 4000;

app.use(express.json({ limit: "64kb" }));
app.use(cors());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/v1", router);

const server = app.listen(PORT, () => {
  console.log(`[BACKEND] listening on port ${PORT}`);
});

async function shutdown(signal: string) {
  console.log(`[BACKEND] ${signal} received, draining connections...`);
  server.close(async () => {
    try {
      await Promise.allSettled([prismaClient.$disconnect(), redis.quit()]);
    } finally {
      process.exit(0);
    }
  });
  // hard exit if a client keeps the socket open past the grace period
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
