-- CreateEnum
CREATE TYPE "TradeType" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "Reasons" AS ENUM ('manual', 'take_profit', 'stop_loss', 'liquidation');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "balance" INTEGER NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClosedOrders" (
    "id" UUID NOT NULL,
    "asset" TEXT NOT NULL,
    "type" "TradeType" NOT NULL,
    "openPrice" BIGINT NOT NULL,
    "closePrice" BIGINT NOT NULL,
    "margin" BIGINT NOT NULL,
    "leverage" INTEGER NOT NULL,
    "closeReason" "Reasons" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "closeTimestamp" TIMESTAMP(3) NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "ClosedOrders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineSnapshot" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openOrders" JSONB NOT NULL,
    "priceStore" JSONB NOT NULL,

    CONSTRAINT "EngineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosedOrders" ADD CONSTRAINT "ClosedOrders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
