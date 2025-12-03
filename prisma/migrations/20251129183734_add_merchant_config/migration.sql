-- CreateTable
CREATE TABLE "MerchantConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "linkBusinessId" TEXT NOT NULL,
    "xrplAddress" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "linkPaymentId" TEXT,
    "linkPaymentUrl" TEXT,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "xrplTxHash" TEXT,
    "xrplConfirmations" INTEGER,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "error" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantConfig_shop_key" ON "MerchantConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_linkPaymentId_key" ON "Payment"("linkPaymentId");

-- CreateIndex
CREATE INDEX "Payment_shop_orderId_idx" ON "Payment"("shop", "orderId");

-- CreateIndex
CREATE INDEX "Payment_linkPaymentId_idx" ON "Payment"("linkPaymentId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "WebhookLog_shop_processed_idx" ON "WebhookLog"("shop", "processed");

-- CreateIndex
CREATE INDEX "WebhookLog_createdAt_idx" ON "WebhookLog"("createdAt");
