// apps/api/src/modules/billing/plan-change.service.ts
// fa-w6-bl-no-plan-downgrade-workflow — antes, não existia NENHUM
// endpoint/serviço para trocar o plano base de uma assinatura já ativa: o
// lojista só contratava um plano uma vez, no checkout inicial (Capítulo 9.3).
// Qualquer troca manual direto no banco/Stripe pulava completamente a validação
// de "o tenant cabe no plano novo" — podendo deixar, por exemplo, um tenant com
// 20 usuários ativos migrado para um plano que só libera 5 assentos inclusos
// (cobrança de excedente silenciosa e inesperada) ou, pior, para um plano
// PERSONAL (B2C) que sequer tem o conceito de múltiplos usuários/módulos de
// nicho.
//
// Filosofia preservada de seat-billing.service.ts ("nunca bloqueia o uso, só
// cobra o excedente") para trocas BUSINESS↔BUSINESS: todo plano BUSINESS tem o
// MESMO conceito de assento/módulo pago, então upgrade ou downgrade entre eles
// nunca é bloqueado — o excedente de assentos/módulos simplesmente passa a ser
// cobrado (ou deixa de ser, se o novo plano libera mais) no próximo ciclo,
// exatamente como já acontece hoje ao ativar um módulo ou criar um usuário.
//
// Bloqueio só existe no único caso em que o PRÓPRIO CONCEITO deixa de existir
// no plano novo: quando o destino é um plano PERSONAL (B2C) — que não tem
// `includedUserSeats`/`extraUserSeatPrice` (não há conceito de headcount pago
// no Filitech Pessoal) nem `includedModules` de nicho B2B. Nesse caso, migrar
// um tenant com mais de 1 usuário ativo ou com módulos de nicho ativos para
// PERSONAL deixaria esses recursos "órfãos" sem nenhuma regra de cobrança ou
// acesso definida — bloqueado com erro acionável, listando exatamente o que
// precisa ser desativado antes.
import { prismaUnscoped } from "@filitech/db";
import { updateBasePlanSubscriptionItem } from "./stripe.client";
import { updateAsaasSubscriptionValue } from "./asaas.client";
import { createModuleLogger } from "../../lib/logger";

const log = createModuleLogger("plan-change");

export interface PlanChangeValidationResult {
  allowed: boolean;
  isDowngrade: boolean;
  activeUserCount: number;
  activeModuleCodes: string[];
  // Presentes só quando allowed=false — o que precisa ser desativado antes de tentar de novo.
  blockingUsersOverLimit?: number;
  blockingModuleCodes?: string[];
  // Presentes mesmo quando allowed=true, para a UI exibir o impacto de cobrança
  // esperado no próximo ciclo (filosofia "nunca bloqueia, só informa o custo").
  extraSeatCount: number;
  modulesRequiringExtraBilling: string[];
}

/**
 * Valida se o tenant pode migrar para `newPlanId` SEM nenhuma ação manual
 * prévia (desativar usuários/módulos). Nunca executa a troca — apenas
 * calcula o diagnóstico; `applyPlanChange` decide com base nele.
 */
export async function validatePlanChange(tenantId: string, newPlanId: string): Promise<PlanChangeValidationResult> {
  const [currentSubscription, newPlan, activeUserCount, activeTenantModules] = await Promise.all([
    prismaUnscoped.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { plan: true } }),
    prismaUnscoped.plan.findUniqueOrThrow({ where: { id: newPlanId } }),
    prismaUnscoped.user.count({ where: { tenantId, active: true } }),
    prismaUnscoped.tenantModule.findMany({ where: { tenantId, active: true }, select: { moduleCode: true } }),
  ]);
  if (!currentSubscription) {
    throw new Error("Tenant sem assinatura ativa — não é possível trocar de plano.");
  }

  const activeModuleCodes = activeTenantModules.map((m) => m.moduleCode);

  // "Downgrade" aqui é definido por valor mensal menor — critério simples e
  // objetivo, suficiente para a UI avisar o lojista ("você está reduzindo seu
  // plano"); a validação de bloqueio abaixo independe desse rótulo.
  const isDowngrade = Number(newPlan.basePrice) < Number(currentSubscription.plan.basePrice);

  // Novo plano sem conceito de assento pago (tipicamente PERSONAL/B2C) — migrar
  // com mais de 1 usuário ativo deixaria usuários extras sem nenhuma regra de
  // cobrança/acesso definida no plano novo. Planos BUSINESS sempre têm esse
  // conceito (ver comentário em schema.prisma, Plan.includedUserSeats), então
  // este ramo nunca bloqueia uma troca BUSINESS↔BUSINESS.
  const newPlanHasNoSeatConcept = newPlan.includedUserSeats === null && newPlan.extraUserSeatPrice === null;
  const blockingUsersOverLimit = newPlanHasNoSeatConcept && activeUserCount > 1 ? activeUserCount - 1 : 0;

  // Novo plano PERSONAL não tem conceito de módulo de nicho B2B — qualquer
  // módulo ativo hoje ficaria órfão (sem cobrança nem gatekeeper de acesso
  // aplicável). Planos BUSINESS sempre aceitam módulos (mesmo que o módulo
  // específico não esteja incluso por padrão — nesse caso ele já é cobrado à
  // parte, sem bloqueio), então este ramo também nunca bloqueia BUSINESS↔BUSINESS.
  const blockingModuleCodes = newPlan.audience === "PERSONAL" ? activeModuleCodes : [];

  const allowed = blockingUsersOverLimit === 0 && blockingModuleCodes.length === 0;

  // Diagnóstico informativo de cobrança esperada (nunca bloqueia) para trocas
  // permitidas entre planos BUSINESS — mesmo cálculo de seat-billing.service.ts.
  const extraSeatCount =
    newPlan.includedUserSeats !== null ? Math.max(0, activeUserCount - newPlan.includedUserSeats) : 0;
  const modulesRequiringExtraBilling = activeModuleCodes.filter((code) => !newPlan.includedModules.includes(code));

  return {
    allowed,
    isDowngrade,
    activeUserCount,
    activeModuleCodes,
    ...(allowed ? {} : { blockingUsersOverLimit, blockingModuleCodes }),
    extraSeatCount,
    modulesRequiringExtraBilling,
  };
}

export interface ApplyPlanChangeResult {
  subscriptionId: string;
  newPlanCode: string;
}

/**
 * Executa a troca de fato — SEMPRE chamado depois de `validatePlanChange`
 * retornar `allowed: true` (o chamador/rota é responsável por checar isso e
 * nunca invocar esta função em caso de bloqueio).
 */
export async function applyPlanChange(tenantId: string, newPlanId: string): Promise<ApplyPlanChangeResult> {
  const [subscription, newPlan] = await Promise.all([
    prismaUnscoped.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
    prismaUnscoped.plan.findUniqueOrThrow({ where: { id: newPlanId } }),
  ]);
  if (!subscription) {
    throw new Error("Tenant sem assinatura ativa — não é possível trocar de plano.");
  }

  if (subscription.provider === "stripe") {
    const activeTenantModules = await prismaUnscoped.tenantModule.findMany({
      where: { tenantId, active: true, stripeSubscriptionItemId: { not: null } },
      select: { stripeSubscriptionItemId: true },
    });
    const excludeItemIds = [
      ...(subscription.stripeSeatSubscriptionItemId ? [subscription.stripeSeatSubscriptionItemId] : []),
      ...activeTenantModules.map((m) => m.stripeSubscriptionItemId!),
    ];

    const result = await updateBasePlanSubscriptionItem({
      tenantId,
      stripeSubscriptionId: subscription.externalSubscriptionId,
      excludeItemIds,
      newPlanLabel: newPlan.label,
      newPlanMonthlyPriceBrl: Number(newPlan.basePrice),
    });
    if (result.ambiguous) {
      log.warn({ tenantId, stripeSubscriptionId: subscription.externalSubscriptionId }, "troca de plano base encontrou mais de um subscription item candidato — usou o primeiro, revisar manualmente no Stripe");
    }
  } else if (subscription.provider === "asaas") {
    const activeModules = await prismaUnscoped.tenantModule.findMany({
      where: { tenantId, active: true },
      include: { module: { select: { monthlyPrice: true } } },
    });
    const modulesTotal = activeModules.reduce((sum, m) => sum + Number(m.module.monthlyPrice), 0);
    await updateAsaasSubscriptionValue(subscription.externalSubscriptionId, Number(newPlan.basePrice) + modulesTotal);
  }

  await prismaUnscoped.subscription.update({ where: { id: subscription.id }, data: { planId: newPlan.id } });

  return { subscriptionId: subscription.id, newPlanCode: newPlan.code };
}
