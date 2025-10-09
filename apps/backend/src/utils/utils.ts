const USD_SCALE = 100;

export function toInternalUsd(price: number): number{
     return Math.round(price * USD_SCALE);
}