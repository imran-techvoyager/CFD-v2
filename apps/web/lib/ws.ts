"use client";

import type { AssetSymbol, Tick } from "./types";
import { getToken } from "./api";

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

const PRICE_SCALE = 10_000;

type TickListener = (tick: Tick) => void;
type OrderEventListener = (event: any) => void;

/**
 * Singleton websocket with auto-reconnect. Components register listeners;
 * every mounted component shares one connection.
 */
class LiveSocket {
  private ws: WebSocket | null = null;
  private tickListeners = new Set<TickListener>();
  private orderListeners = new Set<OrderEventListener>();
  private reconnectDelay = 1000;
  private started = false;

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      (["BTC", "ETH", "SOL"] as const).forEach((symbol) =>
        this.ws?.send(JSON.stringify({ type: "SUBSCRIBE", symbol }))
      );
      const token = getToken();
      if (token) this.ws?.send(JSON.stringify({ type: "AUTH", token }));
    };

    this.ws.onmessage = (msg) => {
      let data: any;
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }

      if (data.type === "order-event") {
        this.orderListeners.forEach((l) => l(data));
        return;
      }

      if (data.symbol && data.askPrice !== undefined) {
        const tick: Tick = {
          symbol: data.symbol as AssetSymbol,
          ask: Number(data.askPrice) / PRICE_SCALE,
          bid: Number(data.bidPrice) / PRICE_SCALE,
          time: Number(data.time),
        };
        this.tickListeners.forEach((l) => l(tick));
      }
    };

    this.ws.onclose = () => {
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  onTick(listener: TickListener) {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  onOrderEvent(listener: OrderEventListener) {
    this.orderListeners.add(listener);
    return () => this.orderListeners.delete(listener);
  }
}

export const liveSocket = new LiveSocket();
