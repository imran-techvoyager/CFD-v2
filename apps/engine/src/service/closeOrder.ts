import { ORDER } from "..";
import prismaClient from "@repo/db/client";
import { calculatePnl } from "./calculatePnl";
import { type CloseOrderReason } from "../types/types";

export async function closeOrder(
  userId: string,
  orderId: string,
  reason: CloseOrderReason,
  closePrice: number
) {
  const order = ORDER[orderId];

  if (!order) return;

  const pnl = calculatePnl({
    side: order.type,
    openPrice: order.openPrice,
    closePrice: closePrice,
    margin: order.margin,
    leverage: order.leverage,
  });

  await prismaClient.$transaction([
    prismaClient.closedOrders.create({
      data: {
        userId,
        type: order.type,
        asset: order.asset,
        openPrice: order.openPrice,
        closePrice: closePrice,
        margin: order.margin,
        leverage: order.leverage,
        closeReason: reason,
        timestamp: new Date(order.timestamp),
        closeTimestamp: new Date(),
      },
    }),

    prismaClient.user.update({
      where: { id: userId },
      data: { balance: { increment: Number(order.margin + pnl) } },
    }),
  ]);

  delete ORDER[orderId];

  console.log(
    `order of order id ${orderId} is closed due to ${reason} reason and pnl is ${pnl}`
  );

  return pnl;
}
