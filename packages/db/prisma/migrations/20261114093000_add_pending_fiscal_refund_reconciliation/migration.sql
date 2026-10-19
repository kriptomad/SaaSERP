-- GAP DE AUDITORIA FECHADO (Capítulo 6.8 — Estorno/Cancelamento Fiscal): o
-- cancelamento fiscal (SEFAZ) é confirmado ANTES da transação local de estorno
-- (ver nota no topo de refund-sale.service.ts — misturar a chamada de rede real à
-- SEFAZ dentro de uma transação de banco já aberta manteria locks de linha presos
-- pelo tempo de resposta da SEFAZ). Isso cria uma janela onde a Fase 1 (fiscal) já
-- comitou mas a Fase 2 (estoque/caixa/status da venda local) falha depois (crash,
-- erro de banco). Antes desta correção, essa falha só virava um log de erro —
-- visível apenas para quem monitora os logs da aplicação em tempo real. Esta
-- tabela é o equivalente ao `FailedOfflineSaleSync` (Capítulo 8.3) para este caso:
-- um registro DURÁVEL e central, visível a qualquer gestor via API, que nunca
-- deixa o estorno "invisível" mesmo que ninguém esteja olhando o log no momento do
-- incidente.
CREATE TABLE "pending_fiscal_refund_reconciliations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "fiscalDocumentId" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "pending_fiscal_refund_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_fiscal_refund_reconciliations_tenantId_resolvedAt_idx" ON "pending_fiscal_refund_reconciliations"("tenantId", "resolvedAt");

-- CreateIndex
CREATE INDEX "pending_fiscal_refund_reconciliations_saleId_idx" ON "pending_fiscal_refund_reconciliations"("saleId");
