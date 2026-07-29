"use client";

import { useMemo, useRef, useState } from "react";
import { INSTRUMENTS, SYMBOLS } from "../lib/instruments";
import { fmtSymbolPrice } from "../lib/format";
import type { AssetSymbol } from "../lib/types";
import type { PriceMap } from "../hooks/usePrices";

type Flash = "up" | "down" | null;

export function Instruments({
  prices,
  selected,
  onSelect,
}: {
  prices: PriceMap;
  selected: AssetSymbol;
  onSelect: (s: AssetSymbol) => void;
}) {
  const [query, setQuery] = useState("");
  const lastBids = useRef<Partial<Record<AssetSymbol, number>>>({});
  const flashes = useRef<Partial<Record<AssetSymbol, Flash>>>({});

  const rows = useMemo(
    () =>
      SYMBOLS.filter(
        (s) =>
          s.toLowerCase().includes(query.toLowerCase()) ||
          INSTRUMENTS[s].name.toLowerCase().includes(query.toLowerCase())
      ),
    [query]
  );

  return (
    <aside className="instruments">
      <div className="instruments-header">
        <span>Instruments</span>
        <div className="instruments-header-actions">
          <button className="mini-btn" title="Options">⋮</button>
          <button className="mini-btn" title="Close">×</button>
        </div>
      </div>

      <div className="instruments-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4-4" />
        </svg>
        <input
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="instruments-fav">
        <span>Favorites</span>
        <span className="caret">▾</span>
      </div>

      <div className="instruments-cols">
        <span>Symbol</span>
        <span>Signal</span>
        <span className="num">Bid</span>
        <span className="num">Ask</span>
      </div>

      {rows.map((s) => {
        const meta = INSTRUMENTS[s];
        const tick = prices[s];
        const prev = lastBids.current[s];
        if (tick && prev !== undefined && tick.bid !== prev) {
          flashes.current[s] = tick.bid > prev ? "up" : "down";
        }
        if (tick) lastBids.current[s] = tick.bid;
        const flash = flashes.current[s] ?? null;

        return (
          <div
            key={s}
            className={`instrument-row ${s === selected ? "active" : ""}`}
            onClick={() => onSelect(s)}
          >
            <span className="drag-dots">⠿</span>
            <span className="coin-icon" style={{ background: meta.color }}>
              {meta.glyph}
            </span>
            <span className="instrument-symbol">{s}</span>
            <span className={`signal ${flash === "down" ? "down" : "up"}`}>
              {flash === "down" ? "↓" : "↑"}
            </span>
            <span className={`px num ${flash ? `flash-${flash}` : ""}`}>
              {fmtSymbolPrice(s, tick?.bid ?? null)}
            </span>
            <span className={`px num ${flash ? `flash-${flash}` : ""}`}>
              {fmtSymbolPrice(s, tick?.ask ?? null)}
            </span>
          </div>
        );
      })}
    </aside>
  );
}
