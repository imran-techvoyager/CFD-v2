"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { fmtLots, fmtPrice, fmtSymbolPrice, fmtUsd } from "../lib/format";
import { INSTRUMENTS, LEVERAGES, accountLeverage, setAccountLeverage } from "../lib/instruments";
import { liveSocket } from "../lib/ws";
import type { AssetSymbol, Tick } from "../lib/types";

export function OrderPanel({
  symbol,
  tick,
  balance,
  onPlaced,
}: {
  symbol: AssetSymbol;
  tick: Tick | undefined;
  balance: number | null;
  onPlaced: () => void;
}) {
  const meta = INSTRUMENTS[symbol];
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [tab, setTab] = useState<"market" | "pending">("market");
  const [volume, setVolume] = useState("1.00");
  const [leverage, setLeverage] = useState(100);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [showMore, setShowMore] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // market sentiment: share of up-ticks over the last 120 ticks
  const dirs = useRef<number[]>([]);
  const lastBid = useRef<number | null>(null);
  const [sellPct, setSellPct] = useState(50);

  useEffect(() => {
    dirs.current = [];
    lastBid.current = null;
    setSellPct(50);
    setLeverage(accountLeverage(symbol));
    const off = liveSocket.onTick((t) => {
      if (t.symbol !== symbol) return;
      if (lastBid.current !== null && t.bid !== lastBid.current) {
        dirs.current.push(t.bid > lastBid.current ? 1 : 0);
        if (dirs.current.length > 120) dirs.current.shift();
        const ups = dirs.current.reduce((a, b) => a + b, 0);
        setSellPct(Math.round(100 - (ups / dirs.current.length) * 100));
      }
      lastBid.current = t.bid;
    });
    return () => {
      off();
    };
  }, [symbol]);

  const volumeNum = parseFloat(volume) || 0;
  const entryPrice = tick ? (side === "buy" ? tick.ask : tick.bid) : 0;
  const units = volumeNum * meta.contractSize;
  const volumeUsd = units * entryPrice;
  const margin = leverage > 0 ? volumeUsd / leverage : 0;
  const spread = tick ? tick.ask - tick.bid : 0;
  const fees = spread * units;
  const pipValue = meta.pip * units;

  function stepVolume(delta: number) {
    const next = Math.max(0.01, Math.round((volumeNum + delta) * 100) / 100);
    setVolume(next.toFixed(2));
  }

  function stepPrice(
    value: string,
    setter: (v: string) => void,
    delta: number,
    fallback: number
  ) {
    const cur = parseFloat(value);
    const base = Number.isFinite(cur) ? cur : fallback;
    const next = Math.max(0, base + delta);
    setter(next.toFixed(meta.digits));
  }

  function changeLeverage(lev: number) {
    setLeverage(lev);
    setAccountLeverage(symbol, lev);
  }

  async function place() {
    setMsg(null);

    if (!tick) return setMsg({ kind: "error", text: "Waiting for live prices…" });
    if (volumeNum < 0.01) return setMsg({ kind: "error", text: "Minimum volume is 0.01 lots" });
    if (balance !== null && margin > balance)
      return setMsg({ kind: "error", text: "Not enough free margin" });

    const tp = parseFloat(takeProfit);
    const sl = parseFloat(stopLoss);
    if (takeProfit && (!Number.isFinite(tp) || tp <= 0))
      return setMsg({ kind: "error", text: "Invalid take profit price" });
    if (stopLoss && (!Number.isFinite(sl) || sl <= 0))
      return setMsg({ kind: "error", text: "Invalid stop loss price" });
    if (takeProfit) {
      if (side === "buy" && tp <= entryPrice)
        return setMsg({ kind: "error", text: "TP must be above the entry price" });
      if (side === "sell" && tp >= entryPrice)
        return setMsg({ kind: "error", text: "TP must be below the entry price" });
    }
    if (stopLoss) {
      if (side === "buy" && sl >= entryPrice)
        return setMsg({ kind: "error", text: "SL must be below the entry price" });
      if (side === "sell" && sl <= entryPrice)
        return setMsg({ kind: "error", text: "SL must be above the entry price" });
    }

    setPlacing(true);
    try {
      const res = await api.placeTrade({
        asset: symbol,
        type: side,
        volume: volumeNum,
        leverage,
        takeprofit: takeProfit ? tp : undefined,
        stoploss: stopLoss ? sl : undefined,
      });
      setMsg({
        kind: "success",
        text: `${side === "buy" ? "Bought" : "Sold"} ${fmtLots(volumeNum)} lots ${symbol} @ ${fmtSymbolPrice(symbol, res.order.openPrice)}`,
      });
      setTakeProfit("");
      setStopLoss("");
      onPlaced();
    } catch (err: any) {
      setMsg({ kind: "error", text: err.message || "trade failed" });
    } finally {
      setPlacing(false);
    }
  }

  return (
    <aside className="order-panel">
      <div className="order-panel-header">
        <span className="coin-icon" style={{ background: meta.color }}>
          {meta.glyph}
        </span>
        <span className="order-panel-symbol">{symbol}</span>
        <button className="mini-btn">×</button>
      </div>

      <div className="form-select">
        Regular form <span className="caret">▾</span>
      </div>

      <div className="side-boxes">
        <button
          className={`side-box sell ${side === "sell" ? "selected" : ""}`}
          onClick={() => setSide("sell")}
        >
          <span className="side-box-label">Sell</span>
          <span className="side-box-price">{fmtSymbolPrice(symbol, tick?.bid)}</span>
        </button>
        <div className="spread-badge">{fmtPrice(fees)} USD</div>
        <button
          className={`side-box buy ${side === "buy" ? "selected" : ""}`}
          onClick={() => setSide("buy")}
        >
          <span className="side-box-label">Buy</span>
          <span className="side-box-price">{fmtSymbolPrice(symbol, tick?.ask)}</span>
        </button>
      </div>

      <div className="sentiment">
        <span className="sent-sell">{sellPct}%</span>
        <div className="sent-bar">
          <div className="sent-fill" style={{ width: `${sellPct}%` }} />
        </div>
        <span className="sent-buy">{100 - sellPct}%</span>
      </div>

      <div className="order-tabs">
        <button
          className={`order-tab ${tab === "market" ? "active" : ""}`}
          onClick={() => setTab("market")}
        >
          Market
        </button>
        <button
          className={`order-tab ${tab === "pending" ? "active" : ""}`}
          onClick={() => setTab("pending")}
        >
          Pending
        </button>
      </div>

      {tab === "pending" ? (
        <div className="pending-note">
          Pending orders are not available on this paper account yet.
        </div>
      ) : (
        <>
          <div className="field">
            <label>Volume</label>
            <div className="stepper">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
              />
              <span className="unit">Lots</span>
              <button className="step-btn" onClick={() => stepVolume(-0.01)}>−</button>
              <button className="step-btn" onClick={() => stepVolume(0.01)}>+</button>
            </div>
          </div>

          <div className="field">
            <label>
              Take Profit <span className="help">?</span>
            </label>
            <div className="stepper">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Not set"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
              />
              <span className="unit">Price ▾</span>
              <button
                className="step-btn"
                onClick={() => stepPrice(takeProfit, setTakeProfit, -meta.pip * 10, entryPrice)}
              >
                −
              </button>
              <button
                className="step-btn"
                onClick={() => stepPrice(takeProfit, setTakeProfit, meta.pip * 10, entryPrice)}
              >
                +
              </button>
            </div>
          </div>

          <div className="field">
            <label>
              Stop Loss <span className="help">?</span>
            </label>
            <div className="stepper">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Not set"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
              />
              <span className="unit">Price ▾</span>
              <button
                className="step-btn"
                onClick={() => stepPrice(stopLoss, setStopLoss, -meta.pip * 10, entryPrice)}
              >
                −
              </button>
              <button
                className="step-btn"
                onClick={() => stepPrice(stopLoss, setStopLoss, meta.pip * 10, entryPrice)}
              >
                +
              </button>
            </div>
          </div>

          {msg && <div className={`panel-msg ${msg.kind}`}>{msg.text}</div>}

          <button
            className={`confirm-btn ${side}`}
            onClick={place}
            disabled={placing || !tick}
          >
            {placing
              ? "Placing…"
              : `Confirm ${side === "buy" ? "Buy" : "Sell"} ${fmtLots(volumeNum)} lots`}
          </button>
          <button
            className="cancel-btn"
            onClick={() => {
              setTakeProfit("");
              setStopLoss("");
              setMsg(null);
            }}
          >
            Cancel
          </button>

          <div className="breakdown">
            <div className="row">
              <span>Fees: <span className="help">?</span></span>
              <span>≈ {fmtPrice(fees)} USD</span>
            </div>
            <div className="row">
              <span>Leverage: <span className="help">?</span></span>
              <select
                className="lev-select"
                value={leverage}
                onChange={(e) => changeLeverage(Number(e.target.value))}
              >
                {LEVERAGES.map((l) => (
                  <option key={l} value={l}>
                    1:{l}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <span>Margin:</span>
              <span>{fmtPrice(margin)} USD</span>
            </div>
            {showMore && (
              <>
                <div className="row">
                  <span>Swap: <span className="help">?</span></span>
                  <span>0.00 USD</span>
                </div>
                <div className="row">
                  <span>Pip Value:</span>
                  <span>{fmtPrice(pipValue)} USD</span>
                </div>
                <div className="row">
                  <span>Volume in units:</span>
                  <span>
                    {fmtLots(units)} {symbol}
                  </span>
                </div>
                <div className="row">
                  <span>Volume in USD:</span>
                  <span>{fmtUsd(volumeUsd)}</span>
                </div>
              </>
            )}
            <button className="more-toggle" onClick={() => setShowMore((m) => !m)}>
              {showMore ? "Less ▴" : "More ▾"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
