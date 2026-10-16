// apps/api/src/modules/billing/dunning.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.4 — Régua de Dunning unificada Stripe/Asaas.
import { prismaUnscoped } from "@filitech/db";
import { notifyTenantPaymentFailed, notifyTenant } from "../notifications/notify.service";

const RETRY_SCHEDULE_DAYS = [1, 3, 5, 7]; // mesma cadência do Stripe Smart Retries

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export async function handlePaymentFailure(tenantId: string, subscriptionId: string) {
  return prismaUnscoped.$transaction(async (tx) => {
    const subscription = await tx.subscription.update({
      where: { id: subscriptionId },
      data: { failedPaymentAttempts: { increment: 1 } },
    });

    const attempt = subscription.failedPaymentAttempts;
    const retryInDays = RETRY_SCHEDULE_DAYS[Math.min(attempt - 1, RETRY_SCHEDULE_DAYS.length - 1)];
    const nextRetryAt = addDays(new Date(), retryInDays);

    await tx.subscription.update({ where: { id: subscriptionId }, data: { nextRetryAt, status: "PAST_DUE" } });

    await tx.tenant.update({
      where: { id: tenantId },
      data: { status: "PAST_DUE", gracePeriodEndsAt: attempt === 1 ? addDays(new Date(), 7) : undefined },
    });

    await notifyTenantPaymentFailed(tenantId, { attempt, nextRetryAt });

    if (attempt >= RETRY_SCHEDULE_DAYS.length) {
      await tx.subscription.update({ where: { id: subscriptionId }, data: { status: "SUSPENDED" } });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } });
    }
  });
}

// GAP DE AUDITORIA FECHADO: eventos de cancelamento definitivo da assinatura no
// provedor (ex.: Stripe `customer.subscription.deleted`, ou `updated` com status
// "canceled"/"unpaid"/"incomplete_expired") só eram refletidos no Filitech pela
// varredura diária de `suspend-overdue-tenants.worker.ts` (até 24h de atraso) ou
// nunca, se o tenant nunca chegasse a `PAST_DUE` internamente (ex.: cancelamento
// voluntário direto no portal do Stripe, sem nenhuma fatura ter falhado antes).
// Diferente de `handlePaymentFailure` (que ainda dá o grace period padrão), aqui
// o provedor já decidiu definitivamente que a assinatura acabou — suspende
// imediatamente, sem esperar o grace period nem a varredura diária.
export async function handleSubscriptionCanceled(tenantId: string, subscriptionId: string) {
  await prismaUnscoped.$transaction([
    prismaUnscoped.subscription.update({ where: { id: subscriptionId }, data: { status: "SUSPENDED" } }),
    prismaUnscoped.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED", gracePeriodEndsAt: null } }),
  ]);
  await notifyTenant({
    tenantId,
    category: "BILLING_DUNNING",
    severity: "CRITICAL",
    title: "Assinatura cancelada",
    body: "Sua assinatura foi cancelada junto ao provedor de pagamento e o acesso ao sistema foi suspenso. Reative o plano para continuar usando o Filitech ERP.",
    linkRoute: "/configuracoes/cobranca",
    sourceType: "SUBSCRIPTION",
    sourceId: tenantId,
  });
}

export async function handlePaymentRecovered(tenantId: string, subscriptionId: string) {
  const current = await prismaUnscoped.subscription.findUnique({ where: { id: subscriptionId }, select: { firstChargedAt: true } });
  await prismaUnscoped.$transaction([
    prismaUnscoped.subscription.update({
      where: { id: subscriptionId },
      data: {
        failedPaymentAttempts: 0,
        nextRetryAt: null,
        status: "ACTIVE",
        // Primeira cobrança bem-sucedida desta assinatura — base da janela de
        // arrependimento do Art. 49 CDC (Capítulo 2.7.6). Nunca sobrescrita depois.
        firstChargedAt: current?.firstChargedAt ?? new Date(),
      },
    }),
    prismaUnscoped.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE", gracePeriodEndsAt: null } }),
  ]);
}
