import prisma from "@repo/db/client";
import { ORDER, PRICESTORE } from "../state";

/**
 * Save current engine state snapshot to DB
 */
export async function saveSnapshot(lastStreamId: string) {
  try {
    const snapshot = await prisma.engineSnapshot.create({
      data: {
        openOrders: ORDER,
        priceStore: PRICESTORE,
        lastStreamId,
      },
    });
    console.log(
      `[SNAPSHOT] Saved snapshot ${snapshot.id} at ${snapshot.timestamp}`
    );

    // Delete older snapshots, keep last 5
    await prisma.engineSnapshot.deleteMany({
      where: {
        id: {
          notIn: (
            await prisma.engineSnapshot.findMany({
              orderBy: { timestamp: "desc" },
              take: 5,
              select: { id: true },
            })
          ).map((s) => s.id),
        },
      },
    });
  } catch (err) {
    console.error("[SNAPSHOT] Failed to save snapshot:", err);
  }
}
