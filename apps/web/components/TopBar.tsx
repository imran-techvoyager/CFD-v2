"use client";

import { useState } from "react";
import { INSTRUMENTS, SYMBOLS } from "../lib/instruments";
import { fmtPrice } from "../lib/format";
import type { AssetSymbol, User } from "../lib/types";

export function TopBar({
  user,
  selected,
  onSelect,
  onLogout,
  onDeposit,
}: {
  user: User | null;
  selected: AssetSymbol;
  onSelect: (s: AssetSymbol) => void;
  onLogout: () => void;
  onDeposit: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo">
          cfd<span>trader</span>
        </div>
        <nav className="symbol-tabs">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              className={`symbol-tab ${s === selected ? "active" : ""}`}
              onClick={() => onSelect(s)}
            >
              <span
                className="coin-icon"
                style={{ background: INSTRUMENTS[s].color }}
              >
                {INSTRUMENTS[s].glyph}
              </span>
              {s}
            </button>
          ))}
          <button className="symbol-tab add" title="More instruments coming soon">
            +
          </button>
        </nav>
      </div>

      <div className="topbar-right">
        <div className="account-chip" onClick={() => setMenuOpen((o) => !o)}>
          <div className="account-chip-top">
            <span className="demo-badge">Demo</span>
            <span className="account-kind">Standard</span>
          </div>
          <div className="account-balance">
            {user ? `${fmtPrice(user.balance)} USD` : "—"} <span className="caret">▾</span>
          </div>
          {menuOpen && (
            <div className="account-menu" onClick={(e) => e.stopPropagation()}>
              <div className="account-menu-email">{user?.email}</div>
              <button className="account-menu-item" onClick={onLogout}>
                Log out
              </button>
            </div>
          )}
        </div>
        <button className="icon-btn" title="Notifications">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 01-3.4 0" />
          </svg>
        </button>
        <button className="icon-btn" title="Apps">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="5" r="2" /><circle cx="12" cy="5" r="2" /><circle cx="19" cy="5" r="2" />
            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
            <circle cx="5" cy="19" r="2" /><circle cx="12" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
          </svg>
        </button>
        <div className="avatar">{user?.email?.[0]?.toUpperCase() ?? "?"}</div>
        <button className="deposit-btn" onClick={onDeposit}>
          Deposit
        </button>
      </div>
    </header>
  );
}
