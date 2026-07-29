-- AlterTable: volume in hundredths of a lot
ALTER TABLE "OpenOrders" ADD COLUMN "volume" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "ClosedOrders" ADD COLUMN "volume" INTEGER NOT NULL DEFAULT 100;
