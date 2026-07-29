"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { api } from "../lib/api";
import { liveSocket } from "../lib/ws";
import { fmtLots, fmtSignedUsd, fmtSymbolPrice } from "../lib/format";
import { INSTRUMENTS } from "../lib/instruments";
import type { AssetSymbol, Candle, OpenOrder, Tick } from "../lib/types";

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const TF_SECONDS: Record<Timeframe, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "4h": 14400, "1d": 86400,
};

const COLORS = {
  up: "#1fc77d",
  down: "#eb483f",
  buy: "#3179f5",
  sell: "#eb483f",
  tp: "#1fc77d",
  sl: "#f0a02c",
  ask: "#3179f5",
  bid: "#eb483f",
};

interface DragState {
  orderId: string;
  kind: "tp" | "sl";
  price: number;
  line: IPriceLine;
  created: boolean; // line created during this drag (chip pull-out)
}

export function ChartPanel({
  symbol,
  timeframe,
  onTimeframe,
  orders,
  tick,
  onModify,
  onClose,
}: {
  symbol: AssetSymbol;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  orders: OpenOrder[]; // open orders on this symbol
  tick: Tick | undefined;
  onModify: (orderId: string, changes: { takeprofit?: number | null; stoploss?: number | null }) => Promise<void>;
  onClose: (orderId: string) => Promise<void>;
}) {
  const meta = INSTRUMENTS[symbol];
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const askLineRef = useRef<IPriceLine | null>(null);
  const bidLineRef = useRef<IPriceLine | null>(null);
  const orderLinesRef = useRef<Map<string, IPriceLine[]>>(new Map());
  const loadingOlderRef = useRef(false);
  const noMoreDataRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);

  const [loading, setLoading] = useState(true);
  const [header, setHeader] = useState<Candle | null>(null);
  const [drag, setDrag] = useState<{ orderId: string; kind: "tp" | "sl"; price: number } | null>(null);

  // ------------------------------------------------------------ chart setup

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { color: "#141823" },
        textColor: "#8a94a6",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1e2432" },
        horzLines: { color: "#1e2432" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#252b3b" },
      timeScale: { borderColor: "#252b3b", timeVisible: true, rightOffset: 6 },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: { type: "price", precision: meta.digits, minMove: 1 / 10 ** meta.digits },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // OHLC header follows the crosshair, falls back to the latest candle
    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(series) as Candle | undefined;
      setHeader(d ?? candlesRef.current[candlesRef.current.length - 1] ?? null);
    });

    // lazy-load older history when scrolling near the left edge
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || loadingOlderRef.current || noMoreDataRef.current) return;
      const bars = series.barsInLogicalRange(range);
      if (bars && bars.barsBefore < 30) void loadOlder();
    });

    // keep HTML overlays glued to their prices across zoom/pan/autoscale
    let raf = 0;
    const tickOverlays = () => {
      const els = container.querySelectorAll<HTMLElement>("[data-price]");
      els.forEach((el) => {
        const price = Number(el.dataset.price);
        const y = series.priceToCoordinate(price);
        if (y === null || y < 8 || y > container.clientHeight - 30) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
        } else {
          el.style.opacity = "1";
          el.style.pointerEvents = "auto";
          el.style.transform = `translateY(${Math.round(y)}px)`;
        }
      });
      raf = requestAnimationFrame(tickOverlays);
    };
    raf = requestAnimationFrame(tickOverlays);

    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      orderLinesRef.current.clear();
      askLineRef.current = null;
      bidLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ candle data

  const loadInitial = useCallback(async () => {
    setLoading(true);
    noMoreDataRef.current = false;
    try {
      const res = await api.candles(symbol, timeframe, 1000);
      candlesRef.current = res.data;
      seriesRef.current?.setData(
        res.data.map((c) => ({ ...c, time: c.time as UTCTimestamp }))
      );
      setHeader(res.data[res.data.length - 1] ?? null);
      chartRef.current?.timeScale().resetTimeScale();
    } catch (err) {
      console.error("failed to load candles:", err);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  const loadOlder = useCallback(async () => {
    const oldest = candlesRef.current[0];
    if (!oldest || loadingOlderRef.current || noMoreDataRef.current) return;
    loadingOlderRef.current = true;
    try {
      const res = await api.candles(symbol, timeframe, 1000, oldest.time * 1000 - 1);
      const older = res.data.filter((c) => c.time < oldest.time);
      if (older.length === 0) {
        noMoreDataRef.current = true;
        return;
      }
      const prevRange = chartRef.current?.timeScale().getVisibleLogicalRange();
      candlesRef.current = [...older, ...candlesRef.current];
      seriesRef.current?.setData(
        candlesRef.current.map((c) => ({ ...c, time: c.time as UTCTimestamp }))
      );
      // keep the viewport anchored on the same bars after prepending
      if (prevRange) {
        chartRef.current?.timeScale().setVisibleLogicalRange({
          from: prevRange.from + older.length,
          to: prevRange.to + older.length,
        });
      }
    } catch (err) {
      console.error("failed to load older candles:", err);
    } finally {
      loadingOlderRef.current = false;
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // live tick -> update the building candle + bid/ask axis labels
  useEffect(() => {
    const bucketSec = TF_SECONDS[timeframe];

    const off = liveSocket.onTick((t) => {
      if (t.symbol !== symbol || !seriesRef.current || loading) return;

      const series = seriesRef.current;
      const price = t.bid;
      const bucket = Math.floor(t.time / bucketSec) * bucketSec;
      const candles = candlesRef.current;
      const last = candles[candles.length - 1];
      if (!last) return;

      try {
        if (bucket > last.time) {
          const candle: Candle = { time: bucket, open: price, high: price, low: price, close: price, volume: 0 };
          candles.push(candle);
          series.update({ ...candle, time: bucket as UTCTimestamp });
        } else if (bucket === last.time) {
          last.high = Math.max(last.high, price);
          last.low = Math.min(last.low, price);
          last.close = price;
          series.update({ ...last, time: last.time as UTCTimestamp });
        }
      } catch {
        /* out-of-order tick during a reload — ignore */
      }

      // bid/ask guide lines on the price axis
      if (!askLineRef.current) {
        askLineRef.current = series.createPriceLine({
          price: t.ask, color: COLORS.ask, lineWidth: 1,
          lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "",
        });
        bidLineRef.current = series.createPriceLine({
          price: t.bid, color: COLORS.bid, lineWidth: 1,
          lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "",
        });
      } else {
        askLineRef.current.applyOptions({ price: t.ask });
        bidLineRef.current?.applyOptions({ price: t.bid });
      }

      setHeader(candles[candles.length - 1] ?? null);
    });

    return () => {
      off();
    };
  }, [symbol, timeframe, loading]);

  // ------------------------------------------------- position lines on chart

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || dragRef.current) return; // don't rebuild mid-drag

    // clear old lines
    orderLinesRef.current.forEach((lines) =>
      lines.forEach((l) => series.removePriceLine(l))
    );
    orderLinesRef.current.clear();

    for (const o of orders) {
      const lines: IPriceLine[] = [];
      lines.push(
        series.createPriceLine({
          price: o.openPrice,
          color: o.type === "buy" ? COLORS.buy : COLORS.sell,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "",
        })
      );
      if (o.takeProfit) {
        lines.push(
          series.createPriceLine({
            price: o.takeProfit, color: COLORS.tp, lineWidth: 1,
            lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "TP",
          })
        );
      }
      if (o.stopLoss) {
        lines.push(
          series.createPriceLine({
            price: o.stopLoss, color: COLORS.sl, lineWidth: 1,
            lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "SL",
          })
        );
      }
      orderLinesRef.current.set(o.orderId, lines);
    }
  }, [orders]);

  // ------------------------------------------------------------ TP/SL drag

  const startDrag = useCallback(
    (e: React.MouseEvent, order: OpenOrder, kind: "tp" | "sl") => {
      e.preventDefault();
      e.stopPropagation();
      const series = seriesRef.current;
      const container = containerRef.current;
      if (!series || !container) return;

      const existing = kind === "tp" ? order.takeProfit : order.stopLoss;
      const startPrice = existing ?? order.openPrice;

      const line = series.createPriceLine({
        price: startPrice,
        color: kind === "tp" ? COLORS.tp : COLORS.sl,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: kind.toUpperCase(),
      });

      dragRef.current = { orderId: order.orderId, kind, price: startPrice, line, created: true };
      setDrag({ orderId: order.orderId, kind, price: startPrice });

      const rect = container.getBoundingClientRect();

      const onMove = (ev: MouseEvent) => {
        const state = dragRef.current;
        if (!state) return;
        const price = series.coordinateToPrice(ev.clientY - rect.top);
        if (price === null || price <= 0) return;
        state.price = price;
        state.line.applyOptions({ price });
        setDrag({ orderId: state.orderId, kind: state.kind, price });
      };

      const onUp = async () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const state = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (!state) return;
        series.removePriceLine(state.line);
        const rounded = Number(state.price.toFixed(meta.digits));
        try {
          await onModify(state.orderId, state.kind === "tp" ? { takeprofit: rounded } : { stoploss: rounded });
        } catch {
          /* parent refresh restores the previous level */
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [meta.digits, onModify]
  );

  // -------------------------------------------------------------- rendering

  const units = (o: OpenOrder) => o.volume * meta.contractSize;
  const levelPnl = (o: OpenOrder, level: number) =>
    (o.type === "buy" ? level - o.openPrice : o.openPrice - level) * units(o);
  const currentPnl = (o: OpenOrder) => {
    if (!tick) return null;
    const exit = o.type === "buy" ? tick.bid : tick.ask;
    return Math.max((o.type === "buy" ? exit - o.openPrice : o.openPrice - exit) * units(o), -o.margin);
  };

  const change = header ? header.close - header.open : 0;
  const changePct = header && header.open ? (change / header.open) * 100 : 0;

  return (
    <div className="chart-area">
      <div className="chart-toolbar">
        <div className="tf-group">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              className={`tf-btn ${tf === timeframe ? "active" : ""}`}
              onClick={() => onTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          {orders.length > 0 && tick && (
            <span
              className={`toolbar-pnl ${orders.reduce((a, o) => a + (currentPnl(o) ?? 0), 0) >= 0 ? "pnl-pos" : "pnl-neg"}`}
            >
              {fmtSignedUsd(orders.reduce((a, o) => a + (currentPnl(o) ?? 0), 0))} USD
            </span>
          )}
        </div>
      </div>

      <div className="chart-container" ref={containerRef}>
        <div className="ohlc-header">
          <span className="coin-icon sm" style={{ background: meta.color }}>
            {meta.glyph}
          </span>
          <b>{meta.name}</b>
          <span className="muted">· {timeframe} ·</span>
          {header && (
            <span className="ohlc-values">
              <span>O<i>{fmtSymbolPrice(symbol, header.open)}</i></span>
              <span>H<i>{fmtSymbolPrice(symbol, header.high)}</i></span>
              <span>L<i>{fmtSymbolPrice(symbol, header.low)}</i></span>
              <span>C<i>{fmtSymbolPrice(symbol, header.close)}</i></span>
              <span className={change >= 0 ? "pnl-pos" : "pnl-neg"}>
                {fmtSignedUsd(change)} ({changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%)
              </span>
            </span>
          )}
        </div>

        {loading && <div className="chart-loading">Loading chart…</div>}

        {/* position overlays: entry badge + TP/SL chips & badges */}
        {orders.map((o) => {
          const pnl = currentPnl(o);
          const dragTp = drag?.orderId === o.orderId && drag.kind === "tp" ? drag.price : null;
          const dragSl = drag?.orderId === o.orderId && drag.kind === "sl" ? drag.price : null;
          const tpPrice = dragTp ?? o.takeProfit;
          const slPrice = dragSl ?? o.stopLoss;

          return (
            <div key={o.orderId}>
              <div
                className={`pos-overlay entry ${o.type}`}
                data-price={o.openPrice}
              >
                {!tpPrice && (
                  <button
                    className="chip tp"
                    title="Drag to set Take Profit"
                    onMouseDown={(e) => startDrag(e, o, "tp")}
                  >
                    TP
                  </button>
                )}
                {!slPrice && (
                  <button
                    className="chip sl"
                    title="Drag to set Stop Loss"
                    onMouseDown={(e) => startDrag(e, o, "sl")}
                  >
                    SL
                  </button>
                )}
                <span className="ov-vol">{fmtLots(o.volume)}</span>
                <span className={`ov-pnl ${pnl !== null && pnl >= 0 ? "pnl-pos" : "pnl-neg"}`}>
                  {pnl === null ? "—" : `${fmtSignedUsd(pnl)} USD`}
                </span>
                <button
                  className="ov-close"
                  title="Close position"
                  onClick={() => void onClose(o.orderId)}
                >
                  ×
                </button>
              </div>

              {tpPrice && (
                <div
                  className="pos-overlay level tp"
                  data-price={tpPrice}
                  onMouseDown={(e) => startDrag(e, o, "tp")}
                  title="Drag to move Take Profit"
                >
                  <span className="ov-vol">{fmtLots(o.volume)}</span>
                  <span className="ov-pnl pnl-pos">
                    {fmtSignedUsd(levelPnl(o, tpPrice))} USD
                  </span>
                  <button
                    className="ov-close"
                    title="Remove Take Profit"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => void onModify(o.orderId, { takeprofit: null })}
                  >
                    ×
                  </button>
                </div>
              )}

              {slPrice && (
                <div
                  className="pos-overlay level sl"
                  data-price={slPrice}
                  onMouseDown={(e) => startDrag(e, o, "sl")}
                  title="Drag to move Stop Loss"
                >
                  <span className="ov-vol">{fmtLots(o.volume)}</span>
                  <span className="ov-pnl pnl-neg">
                    {fmtSignedUsd(levelPnl(o, slPrice))} USD
                  </span>
                  <button
                    className="ov-close"
                    title="Remove Stop Loss"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => void onModify(o.orderId, { stoploss: null })}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
