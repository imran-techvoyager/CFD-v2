import { type Request, type Response } from "express";
import { redis } from "@repo/redis/client";
import { v4 as uuidv4 } from "uuid";
import prismaClient from "@repo/db/client";
import { tradeSchema } from "../types/types";
// import { waitForMessage } from "../utils";
import { RedisSubscriber } from "../utils/redisSubscriber";

const subscriber = new RedisSubscriber();

const addToStream = async (id: string, request: any) => {
  console.log(
    `[CONTROLLER] Adding order ${id} to engine-stream:`,
    JSON.stringify(request, null, 2)
  );
  await redis.xadd(
    "engine-stream",
    "*",
    "data",
    JSON.stringify({
      id,
      request,
    })
  );
  console.log(`[CONTROLLER] Successfully added order ${id} to engine-stream`);
};

export async function sendRequestAndWait(id: string, request: any) {
  console.log(`[CONTROLLER] Starting sendRequestAndWait for order ${id}`);

  try {
    const [_, response] = await Promise.all([
      addToStream(id, request),
      subscriber.waitForMessage(id),
    ]);

    console.log(`[CONTROLLER] Both promises resolved for order ${id}`);
    return response;
  } catch (error) {
    console.error(
      `[CONTROLLER] Error in sendRequestAndWait for order ${id}:`,
      error
    );
    throw error;
  }
}

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

    const payload = {
      kind: "place-trade",
      payload: {
        orderId,
        userId,
        asset,
        type: type, // Changed from 'side' to 'type' to match engine expectations
        margin,
        leverage,
        takeProfit: takeprofit,
        stopLoss: stoploss,
        timestamp: Date.now(),
      },
    };

    const response = await sendRequestAndWait(orderId, payload);

    // Now respond to the client with the order details
    return res.status(200).json({
      msg: "trade opened successfully",
      order: {
        orderId: response.id,
        asset: response.asset,
        side: response.side,
        status: response.status,
        openPrice: Number(response.openPrice),
        takeProfit: Number(response.takeProfit),
        stopLoss: Number(response.stopLoss),
        liquidation: response.liquidation === "true",
        leverage: Number(response.leverage),
        margin: Number(response.margin),
      },
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
      kind: "close-trade",
      payload: {
        orderId,
        userId,
        timestamp: Date.now(),
      },
    };

    //Send close-trade request to engine-stream
    // await redis.xadd(
    //   "engine-stream",
    //   "*",
    //   "kind",
    //   "close-trade",
    //   "payload",
    //   JSON.stringify(payload)
    // );

    const response = await sendRequestAndWait(orderId, payload);

    console.log("Sent close-trade event to engine-stream:", orderId);

    return res.status(200).json({
      msg: response.msg,
      status: response.status,
      orderId,
    });
  } catch (error) {
    console.error("Error while sending close order request:", error);
    return res.status(500).json({ msg: "internal server error" });
  }
}

// export async function getClosedTrades(req: Request, res: Response) {
//   const userId = req.userId;

//   const today = new Date();
//   today.setHours(0, 0, 0, 0);
//   const tomorrow = new Date(today);
//   tomorrow.setDate(today.getDate() + 1);

//   const todaysClosedOrder = await prismaClient.closedOrders.findMany({
//     where: {
//       userId,
//       closeTimestamp: {
//         gte: today,
//         lt: tomorrow,
//       },
//     },
//   });

//   res.status(200).json({
//     trades: todaysClosedOrder,
//   });
// }

function normalizeBigInt(obj: any) {
  return JSON.parse(
    JSON.stringify(obj, (_, v) =>
      typeof v === "bigint" ? Number(v) : v
    )
  );
}

export async function getClosedTrades(req: Request, res: Response) {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ msg: "user not authenticated" });
    }

    const closedOrders = await prismaClient.closedOrders.findMany({
      where: { userId },
      orderBy: { closeTimestamp: "desc" },
    });

    const safeTrades = normalizeBigInt(closedOrders);

    return res.status(200).json({
      msg: "fetched closed trades successfully",
      trades: safeTrades,
    });
  } catch (error) {
    console.error("Error fetching closed trades:", error);
    return res.status(500).json({ msg: "internal server error" });
  }
}


