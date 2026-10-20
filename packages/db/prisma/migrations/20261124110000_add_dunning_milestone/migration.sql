-- fa-w6-bl-dunning-not-durable — ver comentário de design completo em
-- schema.prisma, model `DunningMilestone`: persiste a decisão de notificar um
-- milestone da régua de dunning na MESMA transação que já muda o estado
-- financeiro, para o envio de fato ser feito de forma durável/retentável via
-- BullMQ (workers/dunning-milestone-dispatch.worker.ts), nunca mais inline.

-- CreateEnum
CREATE TYPE "DunningMilestoneType" AS ENUM ('PAYMENT_FAILED', 'SUBSCRIPTION_CANCELED', 'PAYMENT_REVERSED');

-- CreateEnum
CREATE TYPE "DunningMilestoneStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "dunning_milestones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" "DunningMilestoneType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DunningMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "dunning_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dunning_milestones_status_createdAt_idx" ON "dunning_milestones"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "dunning_milestones" ADD CONSTRAINT "dunning_milestones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
