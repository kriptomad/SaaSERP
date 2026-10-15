-- Mega-audit rodada 5, Capítulo 9.3: cache de customer id por PSP no Tenant, estado
-- transitório PENDING_CHECKOUT e carrinho de módulos pendente em Subscription,
-- usados por POST /api/billing/checkout (checkout.routes.ts).

ALTER TABLE "tenants" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "asaasCustomerId" TEXT;

ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PENDING_CHECKOUT';

ALTER TABLE "subscriptions" ADD COLUMN "pendingModuleCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
