// apps/api/src/workers/enforce-scheduled-cancellations.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.6 — reconciliação diária de
// cancelamentos agendados. Subscription.cancelAtPeriodEnd=true + cancelRequestedAt
// preenchido marcam uma intenção de cancelamento registrada em
// subscription.routes.ts; este job efetiva o cancelamento no provedor (Asaas, que
// não suporta agendamento nativo) e sempre fecha o Tenant/Subscription locais assim
// que `currentPeriodEnd` chega, independente do provedor (o Stripe já pode ter
// cancelado sozinho via `cancel_at_period_end`, mas o registro local só é fechado
// aqui, de forma idempotente).
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, scheduledSubscriptionCancellationsQueue } from "../lib/queue";
import { cancelAsaasSubscription } from "../modules/billing/asaas.client";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("enforce-scheduled-cancellations");

const REPEATABLE_JOB_NAME = "daily-sweep";
const DAILY_CRON_4AM = "0 4 * * *";

export async function enforceScheduledCancellationsProcessor(_job: Job): Promise<{ cancelled: number }> {
  const now = new Date();

  const dueSubscriptions = await prismaUnscoped.subscription.findMany({
    where: {
      cancelAtPeriodEnd: true,
      status: { not: "CANCELLED" },
      currentPeriodEnd: { lte: now },
    },
  });

  let cancelled = 0;
  for (const subscription of dueSubscriptions) {
    if (subscription.provider === "asaas") {
      await cancelAsaasSubscription(subscription.externalSubscriptionId).catch((error) => {
        // Já pode ter sido cancelada manualmente no painel do Asaas — não impede o fechamento local.
        log.error({ externalSubscriptionId: subscription.externalSubscriptionId, err: error }, "falha ao cancelar no Asaas");
      });
    }

    await prismaUnscoped.$transaction([
      prismaUnscoped.subscription.update({ where: { id: subscription.id }, data: { status: "CANCELLED" } }),
      prismaUnscoped.tenant.update({ where: { id: subscription.tenantId }, data: { status: "CANCELLED" } }),
    ]);
    cancelled += 1;
  }

  return { cancelled };
}

export function startEnforceScheduledCancellationsWorker(): Worker {
  return new Worker(QUEUE_NAMES.SCHEDULED_SUBSCRIPTION_CANCELLATIONS, enforceScheduledCancellationsProcessor, {
    connection: queueRedisConnection,
  });
}

export async function scheduleEnforceScheduledCancellationsJob(): Promise<void> {
  await scheduledSubscriptionCancellationsQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_4AM },
    { name: REPEATABLE_JOB_NAME },
  );
}
