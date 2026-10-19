-- Auditoria de idempotência: a recompensa de indicação (Capítulo 2.8) marcava
-- `rewardAppliedAt` antes de confirmar o crédito/desconto no provedor de billing
-- (Stripe/Asaas). Estas colunas dão suporte ao padrão outbox/retry: tentativa
-- pendente registrada (`rewardAttemptedAt`) e confirmação por perna
-- (`referrerCreditAppliedAt`/`referredDiscountAppliedAt`), nunca o provedor sendo
-- chamado de novo para uma perna já confirmada num retry após falha parcial.
ALTER TABLE "referrals" ADD COLUMN "rewardAttemptedAt" TIMESTAMP(3);
ALTER TABLE "referrals" ADD COLUMN "referrerCreditAppliedAt" TIMESTAMP(3);
ALTER TABLE "referrals" ADD COLUMN "referredDiscountAppliedAt" TIMESTAMP(3);
