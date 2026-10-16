-- CORREÇÃO DE AUDITORIA (mega-audit rodada 7, Capítulo 9.3): guarda qual cupom foi
-- aplicado em um checkout ainda PENDING_CHECKOUT, para que o job de varredura de
-- checkouts expirados saiba devolver o saldo de redemptionCount com segurança.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pendingCouponId" TEXT;
