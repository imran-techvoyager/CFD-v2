"use client";

import { fmtPrice, fmtSignedUsd, livePnl } from "../lib/format";
import type { OpenOrder, User } from "../lib/types";
import type { PriceMap } from "../hooks/usePrices";

export function BottomBar({
  user,
  openOrders,
  prices,
  onCloseAll,
  closingAll,
}: {
  user: User | null;
  openOrders: OpenOrder[];
  prices: PriceMap;
  onCloseAll: () => void;
  closingAll: boolean;
}) {
  const balance = user?.balance ?? 0;
  const usedMargin = openOrders.reduce((a, o) => a + o.margin, 0);
  const totalPnl = openOrders.reduce((a, o) => a + (livePnl(o, prices[o.asset]) ?? 0), 0);
  const equity = balance + totalPnl;
  const freeMargin = equity - usedMargin;
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : null;

  return (
    <footer className="bottombar">
      <div className="acct-stats">
        <span>
          Equity: <b>{fmtPrice(equity)} USD</b>
        </span>
        <span>
          Free Margin: <b>{fmtPrice(freeMargin)} USD</b>
        </span>
        <span>
          Balance: <b>{fmtPrice(balance)} USD</b>
        </span>
        <span>
          Margin: <b>{fmtPrice(usedMargin)} USD</b>
        </span>
        <span>
          Margin level: <b>{marginLevel === null ? "—" : `${fmtPrice(marginLevel)}%`}</b>
        </span>
      </div>
      <div className="acct-right">
        <span>
          Total P/L, USD:{" "}
          <b className={totalPnl >= 0 ? "pnl-pos" : "pnl-neg"}>
            {fmtSignedUsd(totalPnl)}
          </b>
        </span>
        {openOrders.length > 0 && (
          <button className="close-all-btn" onClick={onCloseAll} disabled={closingAll}>
            {closingAll ? "Closing…" : "Close all"} <span className="caret">▾</span>
          </button>
        )}
      </div>
    </footer>
  );
}
