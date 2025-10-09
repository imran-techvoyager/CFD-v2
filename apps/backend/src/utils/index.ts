import { redis } from "@repo/redis/client";

export async function waitForMessage(orderId: string, timeoutMs = 5000) {
  const startTime = Date.now();
  let lastId = "$"; // start from latest

  while (Date.now() - startTime < timeoutMs) {
    const response = await redis.xread(
      "BLOCK",
      1000, // block for 1 second
      "STREAMS",
      "callback-queue",
      lastId
    );

    if (!response) continue;

    // Redis returns [[streamName, [[id, fields]]]]
    for (const [, messages] of response) {
      for (const [msgId, fields] of messages) {
        const payloadObj: any = {};
        for (let i = 0; i < fields.length; i += 2) {
          payloadObj[fields[i] as string] = fields[i + 1];
        }

        // Parse the actual payload (if JSON encoded)
        const data = JSON.parse(payloadObj.payload || "{}");

        if (data.id === orderId) {
          return data; // found the matching message!
        }

        lastId = msgId; // move cursor forward
      }
    }
  }

  throw new Error("Timeout waiting for callback");
}
