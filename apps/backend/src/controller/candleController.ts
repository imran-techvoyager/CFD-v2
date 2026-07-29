import { type Request, type Response } from "express";

// Candles come from the same venue as the live price feed (Binance),
// so the chart matches what the engine trades on.
const SYMBOL_MAP: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
};

const VALID_INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
]);

export const getCandles = async (req: Request, res: Response) => {
  try {
    const asset = String(req.query.asset || "").toUpperCase();
    const interval = String(req.query.ts || "1m");
    const limit = Math.min(Number(req.query.limit) || 500, 1000);
    const endTime = req.query.endTime ? Number(req.query.endTime) : undefined;

    const symbol = SYMBOL_MAP[asset];
    if (!symbol) {
      return res.status(400).json({ error: "invalid asset (BTC|ETH|SOL)" });
    }
    if (!VALID_INTERVALS.has(interval)) {
      return res.status(400).json({ error: "invalid interval" });
    }

    let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (endTime && Number.isFinite(endTime)) {
      url += `&endTime=${endTime}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Binance API error: ${response.status}`, errorText);
      return res
        .status(502)
        .json({ error: `upstream error: ${response.status}` });
    }

    const data = (await response.json()) as any[];
    if (!Array.isArray(data)) {
      return res.status(502).json({ error: "unexpected upstream format" });
    }

    const candles = data.map((k) => ({
      time: Math.floor(k[0] / 1000), // open time, seconds
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    res.json({ data: candles });
  } catch (error) {
    console.error("Error fetching candles:", error);
    res.status(500).json({
      error: "Failed to fetch candles",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
