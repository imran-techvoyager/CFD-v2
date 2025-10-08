export function calculatePnl(
    {side,
     openPrice,
     closePrice,
     margin,
     leverage
     }:{
     side: "buy" | "sell",
     openPrice: number,
     closePrice: number,
     margin: number,
     leverage: number
     }
    ): number{
      const MONEY_SCALE = 100n;
      const PRICE_SCALE = 10000n;
      const CONVERSION_FACTOR = PRICE_SCALE/MONEY_SCALE;

      const openP = BigInt(openPrice);
      const closeP = BigInt(closePrice);
      const marginCents = BigInt(margin);
      const lev = BigInt(leverage);

      const marginOnPriceScale = marginCents * CONVERSION_FACTOR;
      const totalPositionValue = marginOnPriceScale * lev;

      const priceDiff = side === "buy" ? closeP - openP : openP - closeP;

      let pnlOnPriceScale = (priceDiff * totalPositionValue) / openP;

      const finalPnl = pnlOnPriceScale/CONVERSION_FACTOR;

      return Number(finalPnl);
}