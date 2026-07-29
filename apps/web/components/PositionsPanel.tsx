"use client";

import { useState } from "react";
import { api } from "../lib/api";
import {
  fmtLots,
  fmtSignedUsd,
  fmtSymbolPrice,
  livePnl,
  REASON_LABEL,
} from "../lib/format";
import { INSTRUMENTS } from "../lib/instruments";
import type { ClosedOrder, OpenOrder } from "../lib/types";
import type { PriceMap } from "../hooks/usePrices";

export function PositionsPanel({
  openOrders,
  closedOrders,
  prices,
  onChanged,
  onModify,
}: {
  openOrders: OpenOrder[];
  closedOrders: ClosedOrder[];
  prices: PriceMap;
  onChanged: () => void;
  onModify: (order: OpenOrder) => void;
}) {
  const [tab, setTab] = useState<"open" | "pending" | "closed">("open");
  const [closing, setClosing] = useState<string | null>(null);

  async function handleClose(orderId: string) {
    setClosing(orderId);
    try {
      await api.closeTrade(orderId);
      onChanged();
    } catch (err: any) {
      alert(err.message || "failed to close order");
    } finally {
      setClosing(null);
    }
  }

  return (
    <section className="positions">
      <div className="positions-tabs">
        <button
          className={`pos-tab ${tab === "open" ? "active" : ""}`}
          onClick={() => setTab("open")}
        >
          Open{" "}
          {openOrders.length > 0 && (
            <span className="tab-count">{openOrders.length}</span>
          )}
        </button>
        <button
          className={`pos-tab ${tab === "pending" ? "active" : ""}`}
          onClick={() => setTab("pending")}
        >
          Pending
        </button>
        <button
          className={`pos-tab ${tab === "closed" ? "active" : ""}`}
          onClick={() => setTab("closed")}
        >
          Closed
        </button>
      </div>

      <div className="positions-body">
        {tab === "pending" ? (
          <div className="empty-state">
            <div className="empty-icon">🗂</div>
            No pending orders
          </div>
        ) : tab === "open" ? (
          openOrders.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💼</div>
              No open positions
            </div>
          ) : (
            <table className="pos-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th className="num">Volume, lot</th>
                  <th className="num">Open price</th>
                  <th className="num">Current price</th>
                  <th className="num">T/P</th>
                  <th className="num">S/L</th>
                  <th className="num">P/L, USD</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((o) => {
                  const meta = INSTRUMENTS[o.asset];
                  const tick = prices[o.asset];
                  const cur = tick
                    ? o.type === "buy"
                      ? tick.bid
                      : tick.ask
                    : null;
                  const pnl = livePnl(o, tick);
                  return (
                    <tr key={o.orderId}>
                      <td>
                        <span className="coin-icon sm" style={{ background: meta.color }}>
                          {meta.glyph}
                        </span>
                        <b>{o.asset}</b>
                      </td>
                      <td>
                        <span className={`type-dot ${o.type}`} />
                        <span className={`type-label ${o.type}`}>
                          {o.type === "buy" ? "Buy" : "Sell"}
                        </span>
                      </td>
                      <td className="num">{fmtLots(o.volume)}</td>
                      <td className="num">{fmtSymbolPrice(o.asset, o.openPrice)}</td>
                      <td className="num">{fmtSymbolPrice(o.asset, cur)}</td>
                      <td className="num muted">
                        {o.takeProfit ? fmtSymbolPrice(o.asset, o.takeProfit) : "—"}
                      </td>
                      <td className="num muted">
                        {o.stopLoss ? fmtSymbolPrice(o.asset, o.stopLoss) : "—"}
                      </td>
                      <td className={`num ${pnl === null ? "" : pnl >= 0 ? "pnl-pos" : "pnl-neg"}`}>
                        {pnl === null ? "—" : fmtSignedUsd(pnl)}
                      </td>
                      <td className="row-actions">
                        <button className="mini-action" title="Modify" onClick={() => onModify(o)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
                          </svg>
                        </button>
                        <button
                          className="mini-action close"
                          title="Close position"
                          disabled={closing === o.orderId}
                          onClick={() => handleClose(o.orderId)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M9 9l6 6M15 9l-6 6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : closedOrders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📄</div>
            No closed trades yet
          </div>
        ) : (
          <table className="pos-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Type</th>
                <th className="num">Volume, lot</th>
                <th className="num">Open price</th>
                <th className="num">Close price</th>
                <th>Reason</th>
                <th className="num">P/L, USD</th>
                <th>Closed at</th>
              </tr>
            </thead>
            <tbody>
              {closedOrders.map((o) => {
                const meta = INSTRUMENTS[o.asset];
                return (
                  <tr key={o.orderId}>
                    <td>
                      <span className="coin-icon sm" style={{ background: meta.color }}>
                        {meta.glyph}
                      </span>
                      <b>{o.asset}</b>
                    </td>
                    <td>
                      <span className={`type-dot ${o.type}`} />
                      <span className={`type-label ${o.type}`}>
                        {o.type === "buy" ? "Buy" : "Sell"}
                      </span>
                    </td>
                    <td className="num">{fmtLots(o.volume)}</td>
                    <td className="num">{fmtSymbolPrice(o.asset, o.openPrice)}</td>
                    <td className="num">{fmtSymbolPrice(o.asset, o.closePrice)}</td>
                    <td className="muted">{REASON_LABEL[o.closeReason] ?? o.closeReason}</td>
                    <td className={`num ${o.pnl >= 0 ? "pnl-pos" : "pnl-neg"}`}>
                      {fmtSignedUsd(o.pnl)}
                    </td>
                    <td className="muted">
                      {new Date(o.closeTimestamp).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
