import { type Request, type Response } from "express";
import { redis } from "@repo/redis/client";
import { v4 as uuidv4 } from "uuid";
import prismaClient from "@repo/db/client";
import { closeTradeSchema, modifyTradeSchema, tradeSchema } from "../types/types";
import { RedisSubscriber } from "../utils/redisSubscriber";
import {
  STREAMS,
  VOLUME_SCALE,
  fromInternalPrice,
  fromInternalUsd,
  toInternalPrice,
  type EngineRequest,
} from "@repo/shared";

const subscriber = new RedisSubscriber();

const addToStream = async (id: string, request: EngineRequest) => {
  await redis.xadd(
    STREAMS.ENGINE,
    "*",
    "data",
    JSON.stringify({ id, request })
  );
};

export async function sendRequestAndWait(id: string, request: EngineRequest) {
  const [, response] = await Promise.all([
    addToStream(id, request),
    subscriber.waitForMessage(id),
  ]);
  return response;
}

function engineTimeout(res: Response, error: any) {
  if (String(error?.message || "").startsWith("Timeout")) {
    res
      .status(504)
      .json({ msg: "engine did not respond, please refresh your orders" });
    return true;
  }
  return false;
}

export async function placeTrade(req: Request, res: Response) {
  try {
    const trade = tradeSchema.safeParse(req.body);

    if (!trade.success) {
      return res.status(400).json({ msg: "invalid input" });
    }

    const { asset, type, volume, leverage, takeprofit, stoploss } = trade.data;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ msg: "user not authenticated" });
    }

    const orderId = uuidv4();

    const payload = {
      kind: "place-trade" as const,
      payload: {
        orderId,
        userId,
        asset,
        type,
        volume: Math.round(volume * VOLUME_SCALE),
        leverage,
        takeProfit: takeprofit ? toInternalPrice(takeprofit) : undefined,
        stopLoss: stoploss ? toInternalPrice(stoploss) : undefined,
        timestamp: Date.now(),
      },
    };

    const response = await sendRequestAndWait(orderId, payload);

    if (response.status !== "opened") {
      return res.status(400).json({ msg: response.msg || "trade rejected" });
    }

    return res.status(200).json({
      msg: "trade opened successfully",
      order: {
        orderId,
        asset,
        type,
        status: response.status,
        volume,
        openPrice: fromInternalPrice(Number(response.openPrice)),
        margin: fromInternalUsd(Number(response.margin)),
        takeProfit: response.takeProfit
          ? fromInternalPrice(Number(response.takeProfit))
          : null,
        stopLoss: response.stopLoss
          ? fromInternalPrice(Number(response.stopLoss))
          : null,
        liquidation:
          Number(response.liquidation) > 0
            ? fromInternalPrice(Number(response.liquidation))
            : null,
        leverage,
      },
    });
  } catch (error: any) {
    if (engineTimeout(res, error)) return;
    console.error("Error while creating trade:", error);
    return res.status(500).json({ msg: "internal server error" });
  }
}

export async function closeTrade(req: Request, res: Response) {
  try {
    const parsed = closeTradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ msg: "orderId is required" });
    }

    const { orderId, volume } = parsed.data;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ msg: "user not authenticated" });
    }

    const requestId = uuidv4();
    const payload = {
      kind: "close-trade" as const,
      payload: {
        orderId,
        userId,
        volume: volume ? Math.round(volume * VOLUME_SCALE) : undefined,
        timestamp: Date.now(),
      },
    };

    const response = await sendRequestAndWait(requestId, payload);

    if (response.status !== "closed") {
      return res.status(400).json({ msg: response.msg || "close rejected" });
    }

    return res.status(200).json({
      msg: "trade closed successfully",
      status: response.status,
      orderId,
      partial: response.partial === "true",
      remainingVolume: Number(response.remainingVolume || 0) / VOLUME_SCALE,
      closePrice: fromInternalPrice(Number(response.closePrice)),
      pnl: fromInternalUsd(Number(response.pnl)),
    });
  } catch (error: any) {
    if (engineTimeout(res, error)) return;
    console.error("Error while sending close order request:", error);
    return res.status(500).json({ msg: "internal server error" });
  }
}

export async function modifyTrade(req: Request, res: Response) {
  try {
    const parsed = modifyTradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ msg: "invalid input" });
    }

    const { orderId, takeprofit, stoploss } = parsed.data;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ msg: "user not authenticated" });
    }

    const requestId = uuidv4();
    const payload = {
      kind: "modify-trade" as const,
      payload: {
        orderId,
        userId,
        takeProfit:
          takeprofit === undefined
            ? undefined
            : takeprofit === null
              ? null
              : toInternalPrice(takeprofit),
        stopLoss:
          stoploss === undefined
            ? undefined
            : stoploss === null
              ? null
              : toInternalPrice(stoploss),
        timestamp: Date.now(),
      },
    };

    const response = await sendRequestAndWait(requestId, payload);

    if (response.status !== "modified") {
      return res.status(400).json({ msg: response.msg || "modify rejected" });
    }

    return res.status(200).json({
      msg: "position modified",
      orderId,
      takeProfit: response.takeProfit
        ? fromInternalPrice(Number(response.takeProfit))
        : null,
      stopLoss: response.stopLoss
        ? fromInternalPrice(Number(response.stopLoss))
        : null,
    });
  } catch (error: any) {
    if (engineTimeout(res, error)) return;
    console.error("Error while modifying trade:", error);
    return res.status(500).json({ msg: "internal server error" });
  }
}

export async function getOpenTrades(req: Request, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ msg: "user not authenticated" });
    }

    const requestId = uuidv4();
    const payload = {
      kind: "get-open-orders" as const,
      payload: { userId },
    };

    const response = await sendRequestAndWait(requestId, payload);
    const raw = JSON.parse(response.orders || "[]") as any[];

    const trades = raw.map((o) => ({
      orderId: o.orderId,
      asset: o.asset,
      type: o.type,
      volume: o.volume / VOLUME_SCALE,
      margin: fromInternalUsd(o.margin),
      leverage: o.leverage,
      openPrice: fromInternalPrice(o.openPrice),
      takeProfit: o.takeProfit ? fromInternalPrice(o.takeProfit) : null,
      stopLoss: o.stopLoss ? fromInternalPrice(o.stopLoss) : null,
      liquidation: o.liquidation > 0 ? fromInternalPrice(o.liquidation) : null,
      timestamp: o.timestamp,
    }));

    return res.status(200).json({ trades });
  } catch (error: any) {
    if (engineTimeout(res, error)) return;
    console.error("Error fetching open trades:", error);
    return res.status(500).json({ msg: "internal server error" });
  }
}

export async function getClosedTrades(req: Request, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ msg: "user not authenticated" });
    }

    const closedOrders = await prismaClient.closedOrders.findMany({
      where: { userId },
      orderBy: { closeTimestamp: "desc" },
      take: 200,
    });

    const trades = closedOrders.map((o) => ({
      orderId: o.orderId,
      asset: o.asset,
      type: o.type,
      volume: o.volume / VOLUME_SCALE,
      openPrice: fromInternalPrice(o.openPrice),
      closePrice: fromInternalPrice(o.closePrice),
      margin: fromInternalUsd(o.margin),
      pnl: fromInternalUsd(o.pnl),
      leverage: o.leverage,
      closeReason: o.closeReason,
      timestamp: o.timestamp,
      closeTimestamp: o.closeTimestamp,
    }));

    return res.status(200).json({
      msg: "fetched closed trades successfully",
      trades,
    });
  } catch (error) {
    console.error("Error fetching closed trades:", error);
    return res.status(500).json({ msg: "internal server error" });
  }
}
