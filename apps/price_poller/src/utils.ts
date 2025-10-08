const PRECISION = 10000;

export function toInternalPrice(price: number | string): number{
    return Math.round(parseFloat(price as any) * PRECISION);
}

export function fromInternalPrice(price: number | string): number{
    return Number(price)/PRECISION;
}