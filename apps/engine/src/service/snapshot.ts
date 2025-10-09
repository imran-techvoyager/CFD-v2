import prismaClient from "@repo/db/client";
import { ORDER, PRICESTORE } from "..";
import { getLastStreamId } from "./streamState";

export async function createSnapshot() {
  try {
    const lastStreamId = getLastStreamId();

    await prismaClient.engineSnapshot.create({
      data: {
        openOrders: ORDER,
        priceStore: PRICESTORE,
        lastStreamId,
      },
    });

    console.log(`[SNAPSHOT] Engine state saved at ${new Date().toISOString()}`);

    // Cleanup older snapshots, keep only latest 50
    const count = await prismaClient.engineSnapshot.count();
    if (count > 50) {
      const toDelete = count - 50;
      await prismaClient.$executeRawUnsafe(`
        DELETE FROM "EngineSnapshot"
        WHERE id IN (
          SELECT id FROM "EngineSnapshot"
          ORDER BY "timestamp" ASC
          LIMIT ${toDelete}
        )
      `);
      console.log(`[SNAPSHOT] Cleaned up ${toDelete} old snapshots`);
    }
  } catch (err) {
    console.error("[SNAPSHOT ERROR]", err);
  }
}