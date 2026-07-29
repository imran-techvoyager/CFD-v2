"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { fmtLots, fmtSignedUsd, fmtSymbolPrice, livePnl } from "../lib/format";
import { INSTRUMENTS } from "../lib/instruments";
import type { OpenOrder, Tick } from "../lib/types";

export function ModifyDialog({
  order,
  tick,
  onDone,
  onClose,
}: {
  order: OpenOrder;
  tick: Tick | undefined;
  onDone: () => void;
  onClose: () => void;
}) {
  const meta = INSTRUMENTS[order.asset];
  const [tab, setTab] = useState<"modify" | "partial">("modify");
  const [takeProfit, setTakeProfit] = useState(
    order.takeProfit ? order.takeProfit.toFixed(meta.digits) : ""
  );
  const [stopLoss, setStopLoss] = useState(
    order.stopLoss ? order.stopLoss.toFixed(meta.digits) : ""
  );
  const [closeVolume, setCloseVolume] = useState(
    Math.max(0.01, Math.round((order.volume / 2) * 100) / 100).toFixed(2)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pnl = livePnl(order, tick);
  const currentPrice = tick
    ? order.type === "buy"
      ? tick.bid
      : tick.ask
    : null;

  function stepPrice(value: string, setter: (v: string) => void, delta: number) {
    const cur = parseFloat(value);
    const base = Number.isFinite(cur) ? cur : (currentPrice ?? order.openPrice);
    setter(Math.max(0, base + delta).toFixed(meta.digits));
  }

  async function submitModify() {
    setError(null);
    const tp = takeProfit ? parseFloat(takeProfit) : null;
    const sl = stopLoss ? parseFloat(stopLoss) : null;
    if (takeProfit && (!Number.isFinite(tp!) || tp! <= 0))
      return setError("Invalid take profit price");
    if (stopLoss && (!Number.isFinite(sl!) || sl! <= 0))
      return setError("Invalid stop loss price");

    setBusy(true);
    try {
      await api.modifyTrade(order.orderId, { takeprofit: tp, stoploss: sl });
      onDone();
    } catch (err: any) {
      setError(err.message || "modify failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitPartial() {
    setError(null);
    const vol = parseFloat(closeVolume);
    if (!Number.isFinite(vol) || vol < 0.01)
      return setError("Minimum close volume is 0.01 lots");
    if (vol > order.volume)
      return setError(`Position has only ${fmtLots(order.volume)} lots`);

    setBusy(true);
    try {
      await api.closeTrade(order.orderId, vol);
      onDone();
    } catch (err: any) {
      setError(err.message || "close failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="coin-icon sm" style={{ background: meta.color }}>
            {meta.glyph}
          </span>
          <b>{order.asset}</b>
          <span className="muted">{fmtLots(order.volume)} lot</span>
          <span className={`dialog-pnl ${pnl !== null && pnl >= 0 ? "pnl-pos" : "pnl-neg"}`}>
            {pnl === null ? "—" : `${fmtSignedUsd(pnl)} USD`}
          </span>
          <button className="mini-btn" onClick={onClose}>×</button>
        </div>
        <div className="dialog-sub">
          <span className={`type-label ${order.type}`}>
            {order.type === "buy" ? "Buy" : "Sell"}
          </span>{" "}
          at {fmtSymbolPrice(order.asset, order.openPrice)}
          <span className="dialog-cur">{fmtSymbolPrice(order.asset, currentPrice)}</span>
        </div>

        <div className="dialog-tabs">
          <button
            className={`dialog-tab ${tab === "modify" ? "active" : ""}`}
            onClick={() => setTab("modify")}
          >
            Modify
          </button>
          <button
            className={`dialog-tab ${tab === "partial" ? "active" : ""}`}
            onClick={() => setTab("partial")}
          >
            Partial close
          </button>
        </div>

        {error && <div className="panel-msg error">{error}</div>}

        {tab === "modify" ? (
          <>
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
                <button className="step-btn" onClick={() => stepPrice(takeProfit, setTakeProfit, -meta.pip * 10)}>−</button>
                <button className="step-btn" onClick={() => stepPrice(takeProfit, setTakeProfit, meta.pip * 10)}>+</button>
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
                <button className="step-btn" onClick={() => stepPrice(stopLoss, setStopLoss, -meta.pip * 10)}>−</button>
                <button className="step-btn" onClick={() => stepPrice(stopLoss, setStopLoss, meta.pip * 10)}>+</button>
              </div>
            </div>

            <button className="modify-btn" onClick={submitModify} disabled={busy}>
              {busy ? "Saving…" : "Modify position"}
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>Volume to close (of {fmtLots(order.volume)} lots)</label>
              <div className="stepper">
                <input
                  type="number"
                  min="0.01"
                  max={order.volume}
                  step="0.01"
                  value={closeVolume}
                  onChange={(e) => setCloseVolume(e.target.value)}
                />
                <span className="unit">Lots</span>
                <button
                  className="step-btn"
                  onClick={() =>
                    setCloseVolume(
                      Math.max(0.01, (parseFloat(closeVolume) || 0.01) - 0.01).toFixed(2)
                    )
                  }
                >
                  −
                </button>
                <button
                  className="step-btn"
                  onClick={() =>
                    setCloseVolume(
                      Math.min(order.volume, (parseFloat(closeVolume) || 0) + 0.01).toFixed(2)
                    )
                  }
                >
                  +
                </button>
              </div>
            </div>

            <button className="modify-btn" onClick={submitPartial} disabled={busy}>
              {busy ? "Closing…" : `Close ${closeVolume} lots`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
