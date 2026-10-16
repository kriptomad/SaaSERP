-- CORREÇÃO DE AUDITORIA (mega-audit rodada 7, Capítulo 2.7.4): guarda o ID do
-- pagamento externo da última falha já contabilizada na régua de dunning, para
-- evitar contar duas vezes a mesma falha de cobrança quando o provedor (Asaas)
-- emite mais de um tipo de evento (PAYMENT_OVERDUE + PAYMENT_FAILED) para o
-- mesmo pagamento.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lastFailedPaymentExternalId" TEXT;
