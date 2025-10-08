import { ORDER } from "..";
import { closeOrder } from "./closeOrder";

export async function checkOpenOrders(asset: string, newPrice: {ask: number, bid: number}){
     for(const orderId in ORDER){
         const order = ORDER[orderId];

         if(!order || order.asset !== asset) continue;

         const { userId } = order;

         if(order.takeProfit){
            if(order.type === "buy" && newPrice.bid <= order.takeProfit){
                closeOrder(userId, orderId, "take_profit", newPrice.ask);
                continue;
            }

            if(order.type === "sell" && newPrice.ask >= order.takeProfit){
                closeOrder(userId, orderId, "take_profit", newPrice.ask);
                continue;
            }
         }

         if(order.stopLoss){
            if(order.type === "buy" && newPrice.bid <= order.stopLoss){
                closeOrder(userId, orderId, "stop_loss", newPrice.ask);
                continue;
            }

            if(order.type === "sell" && newPrice.ask >= order.stopLoss){
                 closeOrder(userId, orderId, "stop_loss", newPrice.ask);
                 continue;
            }
         }

         if(order.liquidation){
            if(order.type === "buy" && newPrice.bid <= order.liquidation){
                closeOrder(userId, orderId, "liquidation", newPrice.ask);
                continue;
            }

            if(order.type === "sell" && newPrice.ask >= order.liquidation){
                 closeOrder(userId, orderId, "liquidation", newPrice.ask);
                 continue;
            }
         }
     }
}