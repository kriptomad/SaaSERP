// packages/db/prisma/backfill-tenant-module-from-plan.ts
// Autor: Bruno Costa
// GAP DE AUDITORIA FECHADO (Rodada 6) — `activatePendingSubscription`
// (apps/api/src/modules/billing/webhooks.routes.ts) nunca sincronizava
// `Plan.includedModules` para `TenantModule`, só os módulos à la carte
// escolhidos no checkout (`pendingModuleCodes`). Resultado real: todo tenant
// de um plano/combo que "inclui" um módulo de nicho de graça (ex.:
// LIQUOR_LEDGER em COMBO_ADEGA_PRO) recebia 402 "módulo não contratado" do
// gatekeeper ao tentar usá-lo, mesmo pagando por ele — bug corrigido na
// própria função de ativação para toda assinatura nova/renovada daqui pra
// frente. Este script é a correção pontual (one-off, idempotente) para
// assinaturas já ATIVAS criadas antes da correção.
//
// Também GRANDFATHERING (cláusula de direito adquirido) do módulo
// "ACCOUNTING_OFFICE", recém-criado para fechar o gap de gatekeeper ausente
// em `accounting-office.routes.ts` (Rodada 6, ALTO): qualquer tenant com
// assinatura ATIVA que já tenha um `AccountingEngagement` em uso (como cliente
// OU como escritório contábil) recebe o módulo de graça, para que vínculos já
// existentes nunca sejam quebrados retroativamente pela introdução do gate.
// Tenants SEM nenhum engagement em uso não recebem o módulo automaticamente —
// precisam contratá-lo normalmente dali em diante.
//
// Execução: npx tsx prisma/backfill-tenant-module-from-plan.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const activeSubscriptions = await prisma.subscription.findMany({
    where: { status: "ACTIVE" },
    select: { tenantId: true, plan: { select: { includedModules: true } } },
  });

  let tenantsFixed = 0;
  let modulesActivated = 0;

  for (const sub of activeSubscriptions) {
    if (sub.plan.includedModules.length === 0) continue;

    const existing = await prisma.tenantModule.findMany({
      where: { tenantId: sub.tenantId, moduleCode: { in: sub.plan.includedModules } },
      select: { moduleCode: true, active: true },
    });
    const existingByCode = new Map(existing.map((m) => [m.moduleCode, m.active]));
    const missingOrInactive = sub.plan.includedModules.filter((code) => existingByCode.get(code) !== true);
    if (missingOrInactive.length === 0) continue;

    for (const moduleCode of missingOrInactive) {
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleCode: { tenantId: sub.tenantId, moduleCode } },
        update: { active: true, deactivatedAt: null },
        create: { tenantId: sub.tenantId, moduleCode, active: true },
      });
      modulesActivated += 1;
    }
    tenantsFixed += 1;
  }

  const engagements = await prisma.accountingEngagement.findMany({
    where: { status: { in: ["PENDING_ACCOUNTANT_ACCEPTANCE", "ACTIVE"] } },
    select: { accountingFirmTenantId: true, clientTenantId: true },
  });
  const engagedTenantIds = new Set<string>();
  for (const e of engagements) {
    engagedTenantIds.add(e.accountingFirmTenantId);
    engagedTenantIds.add(e.clientTenantId);
  }
  let accountingGrandfathered = 0;
  for (const tenantId of engagedTenantIds) {
    const current = await prisma.tenantModule.findUnique({
      where: { tenantId_moduleCode: { tenantId, moduleCode: "ACCOUNTING_OFFICE" } },
      select: { active: true },
    });
    if (current?.active) continue;
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleCode: { tenantId, moduleCode: "ACCOUNTING_OFFICE" } },
      update: { active: true, deactivatedAt: null },
      create: { tenantId, moduleCode: "ACCOUNTING_OFFICE", active: true },
    });
    accountingGrandfathered += 1;
  }

  console.log(
    `Backfill concluído: ${tenantsFixed} tenant(s) corrigido(s) (${modulesActivated} módulo(s) de plano ativado(s)), ` +
      `${accountingGrandfathered} tenant(s) com direito adquirido a ACCOUNTING_OFFICE.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
