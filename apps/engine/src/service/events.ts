import { redis } from "@repo/redis/client";
import { CHANNELS } from "@repo/shared";

/**
 * Fire-and-forget realtime notifications, relayed to the browser by the
 * websocket_server. Never lets a pub failure break the engine loop.
 */
export function publishOrderEvent(
  userId: string,
  payload: Record<string, unknown>
) {
  redis
    .publish(CHANNELS.ORDER_EVENTS, JSON.stringify({ userId, ...payload }))
    .catch((err) => console.error("[ENGINE] order-event publish failed:", err));
}
