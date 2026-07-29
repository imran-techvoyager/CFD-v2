"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearSession, getToken } from "../../lib/api";
import { liveSocket } from "../../lib/ws";
import { usePrices } from "../../hooks/usePrices";
import { TopBar } from "../../components/TopBar";
import { IconRail } from "../../components/IconRail";
import { Instruments } from "../../components/Instruments";
import { ChartPanel, type Timeframe } from "../../components/ChartPanel";
import { OrderPanel } from "../../components/OrderPanel";
import { PositionsPanel } from "../../components/PositionsPanel";
import { ModifyDialog } from "../../components/ModifyDialog";
import { BottomBar } from "../../components/BottomBar";
import { fmtSignedUsd, REASON_LABEL } from "../../lib/format";
import type { AssetSymbol, ClosedOrder, OpenOrder, User } from "../../lib/types";

interface Toast {
  id: number;
  kind: "profit" | "loss" | "info";
  title: string;
  detail?: string;
}

export default function TradePage() {
  const router = useRouter();
  const prices = usePrices();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [symbol, setSymbol] = useState<AssetSymbol>("BTC");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [closedOrders, setClosedOrders] = useState<ClosedOrder[]>([]);
  const [modifyTarget, setModifyTarget] = useState<OpenOrder | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [me, open, closed] = await Promise.all([
        api.me(),
        api.openTrades(),
        api.closedTrades(),
      ]);
      setUser(me.user);
      setOpenOrders(open.trades);
      setClosedOrders(closed.trades);
    } catch (err) {
      console.error("refresh failed:", err);
    }
  }, []);

  // auth guard + initial load
  useEffect(() => {
    if (!getToken()) {
      router.replace("/signin");
      return;
    }
    setReady(true);
    refreshAll();
  }, [router, refreshAll]);

  // realtime order events (TP/SL/liquidation fire server-side)
  useEffect(() => {
    liveSocket.start();
    const off = liveSocket.onOrderEvent((event) => {
      if (event.event === "order-closed") {
        const pnlUsd = event.pnl / 100;
        pushToast({
          kind: pnlUsd >= 0 ? "profit" : "loss",
          title: `${event.asset} position ${event.partial ? "partially " : ""}closed — ${REASON_LABEL[event.reason] ?? event.reason}`,
          detail: `P/L ${fmtSignedUsd(pnlUsd)} USD`,
        });
      }
      refreshAll();
    });
    return () => {
      off();
    };
  }, [pushToast, refreshAll]);

  // safety net: periodic refresh in case a WS event is missed
  useEffect(() => {
    const t = setInterval(refreshAll, 15_000);
    return () => clearInterval(t);
  }, [refreshAll]);

  const handleModify = useCallback(
    async (
      orderId: string,
      changes: { takeprofit?: number | null; stoploss?: number | null }
    ) => {
      try {
        await api.modifyTrade(orderId, changes);
      } catch (err: any) {
        pushToast({ kind: "loss", title: "Modify rejected", detail: err.message });
        throw err;
      } finally {
        await refreshAll();
      }
    },
    [pushToast, refreshAll]
  );

  const handleClose = useCallback(
    async (orderId: string) => {
      try {
        const res = await api.closeTrade(orderId);
        pushToast({
          kind: res.pnl >= 0 ? "profit" : "loss",
          title: "Position closed",
          detail: `P/L ${fmtSignedUsd(res.pnl)} USD`,
        });
      } catch (err: any) {
        pushToast({ kind: "loss", title: "Close rejected", detail: err.message });
      } finally {
        await refreshAll();
      }
    },
    [pushToast, refreshAll]
  );

  const handleCloseAll = useCallback(async () => {
    setClosingAll(true);
    try {
      await Promise.allSettled(openOrders.map((o) => api.closeTrade(o.orderId)));
    } finally {
      setClosingAll(false);
      await refreshAll();
    }
  }, [openOrders, refreshAll]);

  function logout() {
    clearSession();
    router.replace("/signin");
  }

  if (!ready) {
    return <div className="loading-screen">Loading…</div>;
  }

  const symbolOrders = openOrders.filter((o) => o.asset === symbol);

  return (
    <div className="terminal">
      <TopBar
        user={user}
        selected={symbol}
        onSelect={setSymbol}
        onLogout={logout}
        onDeposit={() =>
          pushToast({
            kind: "info",
            title: "Paper account",
            detail: "Every account trades with virtual money — no deposits needed.",
          })
        }
      />

      <div className="main-row">
        <IconRail />
        <Instruments prices={prices} selected={symbol} onSelect={setSymbol} />

        <div className="center-col">
          {/* key remounts the chart per symbol: clean state, no stale-series races */}
          <ChartPanel
            key={symbol}
            symbol={symbol}
            timeframe={timeframe}
            onTimeframe={setTimeframe}
            orders={symbolOrders}
            tick={prices[symbol]}
            onModify={handleModify}
            onClose={handleClose}
          />
          <PositionsPanel
            openOrders={openOrders}
            closedOrders={closedOrders}
            prices={prices}
            onChanged={refreshAll}
            onModify={setModifyTarget}
          />
        </div>

        <OrderPanel
          symbol={symbol}
          tick={prices[symbol]}
          balance={user?.balance ?? null}
          onPlaced={refreshAll}
        />
      </div>

      <BottomBar
        user={user}
        openOrders={openOrders}
        prices={prices}
        onCloseAll={handleCloseAll}
        closingAll={closingAll}
      />

      {modifyTarget && (
        <ModifyDialog
          order={openOrders.find((o) => o.orderId === modifyTarget.orderId) ?? modifyTarget}
          tick={prices[modifyTarget.asset]}
          onDone={async () => {
            await refreshAll();
            setModifyTarget(null);
          }}
          onClose={() => setModifyTarget(null)}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.title}
            {t.detail && <small>{t.detail}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}
