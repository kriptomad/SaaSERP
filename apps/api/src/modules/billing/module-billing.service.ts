// apps/api/src/modules/billing/module-billing.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.6 — ativação/desativação de módulo à la
// carte precisa refletir no valor efetivamente cobrado do tenant no provedor de
// billing (Stripe/Asaas), não só no `TenantModule.active` local.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `modules.routes.ts` ativava/desativava o
// módulo só no banco — nenhuma chamada ao Stripe/Asaas era feita, então o lojista
// ganhava o módulo de graça (ou continuava sendo cobrado por um módulo já removido).
//
// Mesmo padrão best-effort de seat-billing.service.ts: uma falha aqui (sem
// assinatura ainda, Asaas fora do ar, etc.) NUNCA deve impedir a ativação/
// desativação do módulo em si — fica registrada em log para reconciliação manual.
import { prisma as unscopedPrisma } from "@filitech/db";
import { addModuleToStripeSubscription, removeModuleFromStripeSubscription } from "./stripe.client";
import { updateAsaasSubscriptionValue } from "./asaas.client";
import { createModuleLogger } from "../../lib/logger";

const log = createModuleLogger("module-billing");

async function getActiveSubscription(tenantId: string) {
  return unscopedPrisma.subscription.findFirst({
    where: { tenantId, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
    include: { plan: { select: { basePrice: true } } },
  });
}

async function recalculateAsaasTotal(tenantId: string, subscriptionId: string, basePrice: number): Promise<number> {
  const activeModules = await unscopedPrisma.tenantModule.findMany({
    where: { tenantId, active: true },
    include: { module: { select: { monthlyPrice: true } } },
  });
  const modulesTotal = activeModules.reduce((sum, m) => sum + Number(m.module.monthlyPrice), 0);
  const total = basePrice + modulesTotal;
  await updateAsaasSubscriptionValue(subscriptionId, total);
  return total;
}

/**
 * Chamado logo após `TenantModule.active = true` ser persistido. Cria o
 * subscription item dedicado no Stripe (ou recalcula o valor total no Asaas).
 */
export async function chargeModuleActivation(tenantId: string, moduleCode: string): Promise<void> {
  try {
    const subscription = await getActiveSubscription(tenantId);
    if (!subscription) {
      log.warn({ tenantId, moduleCode }, "ativação de módulo sem assinatura ativa — cobrança não sincronizada com o provedor");
      return;
    }
    const module = await unscopedPrisma.module.findUnique({ where: { code: moduleCode } });
    if (!module) return;

    if (subscription.provider === "stripe") {
      const itemId = await addModuleToStripeSubscription(tenantId, subscription.externalSubscriptionId, moduleCode, module.label, Number(module.monthlyPrice));
      await unscopedPrisma.tenantModule.update({
        where: { tenantId_moduleCode: { tenantId, moduleCode } },
        data: { stripeSubscriptionItemId: itemId },
      });
    } else if (subscription.provider === "asaas") {
      await recalculateAsaasTotal(tenantId, subscription.externalSubscriptionId, Number(subscription.plan.basePrice));
    }
  } catch (err) {
    log.error({ tenantId, moduleCode, err }, "falha ao sincronizar ativação de módulo com o provedor de billing");
  }
}

/**
 * Chamado logo após `TenantModule.active = false` ser persistido. Remove o
 * subscription item do Stripe (ou recalcula o valor total no Asaas).
 */
export async function chargeModuleDeactivation(tenantId: string, moduleCode: string): Promise<void> {
  try {
    const subscription = await getActiveSubscription(tenantId);
    if (!subscription) return;

    if (subscription.provider === "stripe") {
      const tenantModule = await unscopedPrisma.tenantModule.findUnique({ where: { tenantId_moduleCode: { tenantId, moduleCode } } });
      if (tenantModule?.stripeSubscriptionItemId) {
        await removeModuleFromStripeSubscription(tenantModule.stripeSubscriptionItemId);
        await unscopedPrisma.tenantModule.update({
          where: { tenantId_moduleCode: { tenantId, moduleCode } },
          data: { stripeSubscriptionItemId: null },
        });
      }
    } else if (subscription.provider === "asaas") {
      await recalculateAsaasTotal(tenantId, subscription.externalSubscriptionId, Number(subscription.plan.basePrice));
    }
  } catch (err) {
    log.error({ tenantId, moduleCode, err }, "falha ao sincronizar desativação de módulo com o provedor de billing");
  }
}
