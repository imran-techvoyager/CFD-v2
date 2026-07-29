import type { ClosedOrder, OpenOrder, Candle, User } from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function setSession(token: string, user: User) {
  localStorage.setItem("token", token);
  localStorage.setItem("email", user.email);
}

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("email");
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      clearSession();
      window.location.href = "/signin";
    }
    throw new ApiError(res.status, body.msg || body.error || "request failed");
  }
  return body as T;
}

export const api = {
  signup: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  signin: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/signin", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ user: User }>("/auth/me"),

  placeTrade: (params: {
    asset: string;
    type: "buy" | "sell";
    volume: number; // lots
    leverage: number;
    takeprofit?: number;
    stoploss?: number;
  }) =>
    request<{ msg: string; order: OpenOrder & { status: string } }>("/trade", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  closeTrade: (orderId: string, volume?: number) =>
    request<{
      msg: string;
      pnl: number;
      closePrice: number;
      partial: boolean;
      remainingVolume: number;
    }>("/trade/close", {
      method: "POST",
      body: JSON.stringify({ orderId, volume }),
    }),

  modifyTrade: (
    orderId: string,
    changes: { takeprofit?: number | null; stoploss?: number | null }
  ) =>
    request<{ msg: string; takeProfit: number | null; stopLoss: number | null }>(
      "/trade/modify",
      {
        method: "POST",
        body: JSON.stringify({ orderId, ...changes }),
      }
    ),

  openTrades: () => request<{ trades: OpenOrder[] }>("/trade/open"),

  closedTrades: () => request<{ trades: ClosedOrder[] }>("/trade"),

  candles: (asset: string, interval: string, limit = 1000, endTime?: number) =>
    request<{ data: Candle[] }>(
      `/candles?asset=${asset}&ts=${interval}&limit=${limit}${endTime ? `&endTime=${endTime}` : ""}`
    ),
};
