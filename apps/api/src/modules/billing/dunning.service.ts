// apps/api/src/modules/billing/dunning.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.4 — Régua de Dunning unificada Stripe/Asaas.
import { prismaUnscoped } from "@filitech/db";
import { notifyTenantPaymentFailed } from "../notifications/notify.service";

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

export async function handlePaymentRecovered(tenantId: string, subscriptionId: string) {
  await prismaUnscoped.$transaction([
    prismaUnscoped.subscription.update({
      where: { id: subscriptionId },
      data: { failedPaymentAttempts: 0, nextRetryAt: null, status: "ACTIVE" },
    }),
    prismaUnscoped.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE", gracePeriodEndsAt: null } }),
  ]);
}
