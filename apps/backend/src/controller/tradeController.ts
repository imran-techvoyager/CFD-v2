import { type Request, type Response } from "express";
import { redis } from "@repo/redis/client";
import { v4 as uuidv4 } from "uuid";
import prismaClient from "@repo/db/client";
import { tradeSchema } from "../types/types";

export async function placeTrade(req: Request, res: Response) {
  try {
    const trade = tradeSchema.safeParse(req.body);

    if (!trade.success) {
      return res.status(400).json({ msg: "invalid input" });
    }

    const { asset, type, margin, leverage, takeprofit, stoploss } = trade.data;
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ msg: "userId missing from request" });
    }

    const user = await prismaClient.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(400).json({ msg: "user does not exist" });
    }

    if (user.balance < margin) {
      return res.status(400).json({ msg: "insufficient balance" });
    }

    const orderId = uuidv4();

    const order = {
      orderId,
      userId,
      type,
      asset,
      margin,
      leverage,
      takeProfit: takeprofit,
      stopLoss: stoploss,
      timestamp: Date.now(),
    };

    //Publish the order to Redis stream for engine to process
    await redis.xadd(
      "engine-stream",
      "*",
      "kind",
      "place-trade",
      "payload",
      JSON.stringify(order)
    );

    console.log("Sent to engine-stream:", orderId);

    return res.status(200).json({
      msg: "trade request sent to engine",
      orderId,
    });
  } catch (error) {
    console.error("Error while creating trade:", error);
    return res.status(500).json({ msg: "internal server error" });
  }
}

export async function closeTrade(req: Request, res: Response) {
  try {
    console.log("inside closeTrade route");

    const { orderId } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ msg: "user not authenticated" });
    }

    if (!orderId) {
      return res.status(400).json({ msg: "orderId is required" });
    }

    const payload = {
      orderId,
      userId,
      timestamp: Date.now(),
    };

    //Send close-trade request to engine-stream
    await redis.xadd(
      "engine-stream",
      "*",
      "kind",
      "close-trade",
      "payload",
      JSON.stringify(payload)
    );

    console.log("Sent close-trade event to engine-stream:", orderId);

    return res.status(200).json({
      msg: "close order request sent to engine",
      orderId,
    });
  } catch (error) {
    console.error("Error while sending close order request:", error);
    return res.status(500).json({ msg: "internal server error" });
  }
}

export async function getClosedTrades(req: Request, res: Response) {
  const userId = req.userId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const todaysClosedOrder = await prismaClient.closedOrders.findMany({
    where: {
      userId,
      closeTimestamp: {
        gte: today,
        lt: tomorrow,
      },
    },
  });

  res.status(200).json({
    trades: todaysClosedOrder,
  });
}