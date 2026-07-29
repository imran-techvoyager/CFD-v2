-- CreateTable
CREATE TABLE "OpenOrders" (
    "id" UUID NOT NULL,
    "orderId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "type" "TradeType" NOT NULL,
    "openPrice" BIGINT NOT NULL,
    "margin" BIGINT NOT NULL,
    "leverage" INTEGER NOT NULL,
    "takeProfit" BIGINT,
    "stopLoss" BIGINT,
    "liquidation" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "OpenOrders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenOrders_orderId_key" ON "OpenOrders"("orderId");

-- CreateIndex
CREATE INDEX "OpenOrders_userId_idx" ON "OpenOrders"("userId");

-- AddForeignKey
ALTER TABLE "OpenOrders" ADD CONSTRAINT "OpenOrders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
