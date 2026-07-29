import { ORDER, ORDERS_BY_SYMBOL, type PriceEntry } from "../state";
import { closeOrder } from "./closeOrder";

/**
 * Runs on every price tick. Only visits orders on the ticking symbol (via
 * the ORDERS_BY_SYMBOL index) — tick cost is O(orders on symbol), not
 * O(whole book).
 *
 * Exit prices always use the side the trader would actually get: bid to
 * close a buy, ask to close a sell. Liquidation is checked first — when a
 * tick crosses several triggers at once, the most severe one wins.
 */
export async function checkOpenOrders(asset: string, newPrice: PriceEntry) {
  const ids = ORDERS_BY_SYMBOL.get(asset);
  if (!ids || ids.size === 0) return;

  // snapshot the id list: closes mutate the set while we iterate
  for (const orderId of [...ids]) {
    const order = ORDER[orderId];
    if (!order) continue;

    const exitPrice = order.type === "buy" ? newPrice.bid : newPrice.ask;

    try {
      if (order.liquidation > 0) {
        if (
          (order.type === "buy" && exitPrice <= order.liquidation) ||
          (order.type === "sell" && exitPrice >= order.liquidation)
        ) {
          await closeOrder(orderId, "liquidation", exitPrice);
          continue;
        }
      }

      if (order.takeProfit) {
        if (
          (order.type === "buy" && exitPrice >= order.takeProfit) ||
          (order.type === "sell" && exitPrice <= order.takeProfit)
        ) {
          await closeOrder(orderId, "take_profit", exitPrice);
          continue;
        }
      }

      if (order.stopLoss) {
        if (
          (order.type === "buy" && exitPrice <= order.stopLoss) ||
          (order.type === "sell" && exitPrice >= order.stopLoss)
        ) {
          await closeOrder(orderId, "stop_loss", exitPrice);
        }
      }
    } catch (err) {
      console.error(`[ENGINE] Failed auto-close for ${orderId}:`, err);
    }
  }
}
