-- AlterTable: add orderId (backfill existing rows with their row id) and pnl
ALTER TABLE "ClosedOrders" ADD COLUMN "orderId" TEXT;
UPDATE "ClosedOrders" SET "orderId" = "id"::text WHERE "orderId" IS NULL;
ALTER TABLE "ClosedOrders" ALTER COLUMN "orderId" SET NOT NULL;

ALTER TABLE "ClosedOrders" ADD COLUMN "pnl" BIGINT NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "ClosedOrders_orderId_key" ON "ClosedOrders"("orderId");

-- CreateIndex
CREATE INDEX "ClosedOrders_userId_closeTimestamp_idx" ON "ClosedOrders"("userId", "closeTimestamp");
