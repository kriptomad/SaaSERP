-- fa-billing-webhook-idempotency-race: BillingEvent passa a modelar um estado
-- explícito de processamento (PROCESSING com lease de expiração → SUCCEEDED/FAILED)
-- em vez de "a linha existe = já processado". Reentregas que chegam enquanto o
-- evento está PROCESSING (e a lease ainda não expirou) recebem um erro não-2xx do
-- webhook, nunca um 200 "duplicate" prematuro antes da transação de negócio
-- correspondente ter de fato commitado — ver claimBillingEvent() em
-- webhooks.routes.ts.
CREATE TYPE "BillingEventStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "billing_events" ADD COLUMN "status" "BillingEventStatus" NOT NULL DEFAULT 'PROCESSING';

-- Backfill: todo BillingEvent já existente nesta tabela antes desta migration
-- representa processamento histórico já concluído (não há mais nenhum worker em
-- voo sobre eles) — marcado SUCCEEDED para não ficar "PROCESSING" indefinidamente
-- e bloquear reentregas antigas que porventura ainda cheguem.
UPDATE "billing_events" SET "status" = 'SUCCEEDED';

ALTER TABLE "billing_events" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
UPDATE "billing_events" SET "leaseExpiresAt" = "createdAt" WHERE "leaseExpiresAt" IS NULL;
ALTER TABLE "billing_events" ALTER COLUMN "leaseExpiresAt" SET NOT NULL;

ALTER TABLE "billing_events" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- fa-billing-outoforder-active-reactivation: guarda monotônica contra webhooks
-- entregues fora de ordem (ex.: Stripe reentrega um `customer.subscription.updated`
-- antigo DEPOIS de um evento mais recente já ter sido processado) — compara
-- `event.created` contra este timestamp antes de qualquer reativação/mudança de
-- estado financeiro, nunca confiando apenas na ordem de chegada HTTP. Ver
-- claimEventOrdering() em dunning.service.ts.
ALTER TABLE "subscriptions" ADD COLUMN "lastFinancialEventAt" TIMESTAMP(3);
