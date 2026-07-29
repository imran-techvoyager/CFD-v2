import prisma from "@repo/db/client";
import { ORDER, PRICESTORE, trackOrder } from "../state";

/**
 * Snapshot persists the stream cursor (and debug copies of in-memory state).
 * Open orders themselves are recovered from the OpenOrders table, which is
 * transactionally correct; the snapshot only tells the engine where to
 * resume reading the stream.
 */
export async function saveSnapshot(lastStreamId: string) {
  try {
    const snapshot = await prisma.engineSnapshot.create({
      data: {
        openOrders: JSON.parse(JSON.stringify(ORDER)),
        priceStore: JSON.parse(JSON.stringify(PRICESTORE)),
        lastStreamId,
      },
    });
    console.log(`[SNAPSHOT] Saved ${snapshot.id} (cursor ${lastStreamId})`);

    // keep only the 5 most recent snapshots
    const keep = await prisma.engineSnapshot.findMany({
      orderBy: { timestamp: "desc" },
      take: 5,
      select: { id: true },
    });
    await prisma.engineSnapshot.deleteMany({
      where: { id: { notIn: keep.map((s) => s.id) } },
    });
  } catch (err) {
    console.error("[SNAPSHOT] Failed to save snapshot:", err);
  }
}

/**
 * Rebuild in-memory state after a restart:
 *  - open orders come from the OpenOrders table (source of truth)
 *  - price store from the latest snapshot (stale prices are replaced by
 *    replayed/live ticks immediately)
 * Returns the stream id to resume reading from, or null to start at "$".
 */
export async function restoreState(): Promise<string | null> {
  const rows = await prisma.openOrders.findMany();
  for (const row of rows) {
    trackOrder(row.orderId, {
      userId: row.userId,
      type: row.type,
      asset: row.asset,
      margin: Number(row.margin),
      volume: row.volume,
      leverage: row.leverage,
      openPrice: Number(row.openPrice),
      timestamp: row.timestamp.getTime(),
      takeProfit: row.takeProfit ? Number(row.takeProfit) : undefined,
      stopLoss: row.stopLoss ? Number(row.stopLoss) : undefined,
      liquidation: Number(row.liquidation),
    });
  }
  console.log(`[SNAPSHOT] Restored ${rows.length} open orders from DB.`);

  const latest = await prisma.engineSnapshot.findFirst({
    orderBy: { timestamp: "desc" },
  });
  if (!latest) {
    console.log("[SNAPSHOT] No snapshot found, starting from live stream.");
    return null;
  }

  // restored prices are only context — updatedAt stays as saved (or 0), so
  // the stale-price guard blocks new opens until live ticks arrive
  const savedPrices = (latest.priceStore ?? {}) as Record<
    string,
    { ask: number; bid: number; updatedAt?: number }
  >;
  for (const [symbol, p] of Object.entries(savedPrices)) {
    PRICESTORE[symbol] = { ask: p.ask, bid: p.bid, updatedAt: p.updatedAt ?? 0 };
  }
  console.log(`[SNAPSHOT] Resuming stream after ${latest.lastStreamId}`);
  return latest.lastStreamId || null;
}
