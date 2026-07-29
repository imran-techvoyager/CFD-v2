"use client";

import { useEffect, useState } from "react";
import { liveSocket } from "../lib/ws";
import type { AssetSymbol, Tick } from "../lib/types";

export type PriceMap = Partial<Record<AssetSymbol, Tick>>;

export function usePrices(): PriceMap {
  const [prices, setPrices] = useState<PriceMap>({});

  useEffect(() => {
    liveSocket.start();
    const off = liveSocket.onTick((tick) => {
      setPrices((prev) => ({ ...prev, [tick.symbol]: tick }));
    });
    return () => {
      off();
    };
  }, []);

  return prices;
}
