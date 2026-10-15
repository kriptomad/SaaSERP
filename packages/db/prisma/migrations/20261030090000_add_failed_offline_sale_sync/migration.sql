-- GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 3, Capítulo 8.3 — PDV Offline): uma
-- venda offline que falha ao sincronizar por erro de negócio real (estoque esgotado
-- por outro terminal, série/variação inválida etc.) só ficava visível no IndexedDB
-- daquele terminal específico. Esta tabela dá visibilidade central (qualquer gestor,
-- de qualquer terminal) e permite reconciliação manual.

-- CreateTable
CREATE TABLE "failed_offline_sale_syncs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "errorCode" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "failed_offline_sale_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "failed_offline_sale_syncs_tenantId_idempotencyKey_key" ON "failed_offline_sale_syncs"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "failed_offline_sale_syncs_tenantId_resolvedAt_idx" ON "failed_offline_sale_syncs"("tenantId", "resolvedAt");
