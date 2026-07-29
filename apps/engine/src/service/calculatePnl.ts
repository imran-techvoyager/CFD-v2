const PRICE_SCALE = 10_000n;

/**
 * PnL from position size (exact, no leverage rounding):
 *   units       = (volume / VOLUME_SCALE) * contractSize
 *   pnl dollars = priceDiff * units
 * With prices on the 1e4 scale, volume in hundredths of a lot and money in
 * cents, everything cancels to one BigInt division:
 *   pnlCents = diff1e4 * volumeE2 * contract / 1e4
 * Clamped so a position can never lose more than its margin.
 */
export function calculatePnl({
  side,
  openPrice,
  closePrice,
  volume, // hundredths of a lot
  contractSize,
  margin, // cents — clamp floor
}: {
  side: "buy" | "sell";
  openPrice: number;
  closePrice: number;
  volume: number;
  contractSize: number;
  margin: number;
}): number {
  const openP = BigInt(Math.round(openPrice));
  const closeP = BigInt(Math.round(closePrice));
  if (openP <= 0n) return 0;

  const priceDiff = side === "buy" ? closeP - openP : openP - closeP;

  let pnl =
    (priceDiff * BigInt(Math.round(volume)) * BigInt(contractSize)) /
    PRICE_SCALE;

  const marginCents = BigInt(Math.round(margin));
  if (pnl < -marginCents) pnl = -marginCents;

  return Number(pnl);
}

/**
 * Required margin in cents: notional / leverage, rounded up so a position is
 * never under-collateralised by a fraction of a cent.
 */
export function calculateMargin(
  openPrice: number, // 1e4 scale
  volume: number, // hundredths of a lot
  contractSize: number,
  leverage: number
): number {
  const numerator =
    BigInt(Math.round(openPrice)) *
    BigInt(Math.round(volume)) *
    BigInt(contractSize);
  const denominator = PRICE_SCALE * BigInt(leverage);
  return Number((numerator + denominator - 1n) / denominator);
}

/**
 * Liquidation price (1e4 scale). Position is force-closed when equity hits
 * zero: loss == margin  =>  |priceMove/openPrice| == 1/leverage.
 * Returns 0 when the position can never liquidate (1x buy bottoms at 0).
 */
export function calculateLiquidationPrice(
  side: "buy" | "sell",
  openPrice: number,
  leverage: number
): number {
  if (side === "buy") {
    if (leverage <= 1) return 0;
    return Math.ceil(openPrice * (1 - 1 / leverage));
  }
  return Math.floor(openPrice * (1 + 1 / leverage));
}
