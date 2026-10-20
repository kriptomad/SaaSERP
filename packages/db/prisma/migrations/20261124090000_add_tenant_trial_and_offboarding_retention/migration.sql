-- fa-w6-bl-no-trial-expiry-enforcement: fim do trial SaaS (14 dias, definido no
-- signup), consultado pelo worker de expiração de trial e pelo Tenant Lockout
-- (defesa em profundidade).
ALTER TABLE "tenants" ADD COLUMN "trialEndsAt" TIMESTAMP(3);

-- fa-w6-bl-no-offboarding-retention: timestamps/razão de suspensão e prazo de
-- expurgo/anonimização de offboarding de tenants SUSPENDED.
ALTER TABLE "tenants" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "suspensionReason" TEXT;
ALTER TABLE "tenants" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);

CREATE INDEX "tenants_status_purgeAt_idx" ON "tenants"("status", "purgeAt");
CREATE INDEX "tenants_status_trialEndsAt_idx" ON "tenants"("status", "trialEndsAt");
