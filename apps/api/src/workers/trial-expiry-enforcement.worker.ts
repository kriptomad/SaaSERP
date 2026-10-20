// apps/api/src/workers/trial-expiry-enforcement.worker.ts
// fa-w6-bl-no-trial-expiry-enforcement — Antes deste worker, o trial SaaS
// (`Tenant.status = TRIAL`) NUNCA expirava sozinho: um tenant que nunca contratasse
// um plano pago permanecia TRIAL (acesso completo ao plano gratuito) para sempre,
// diferente do trial de 15 dias da Licença Mestra técnica (Capítulo 2.10,
// `licensing.routes.ts`), que já é autoexpirável — os dois são conceitos
// INDEPENDENTES (ver nota em `schema.prisma`, campo `Tenant.trialEndsAt`).
//
// Varre diariamente tenants TRIAL cujo `trialEndsAt` já passou e que não possuem
// nenhuma assinatura ACTIVE/PAST_DUE confirmada (checagem defensiva — na prática,
// uma assinatura confirmada via webhook já teria tirado o tenant de TRIAL antes
// disso, mas nunca sobrescrevemos um pagamento real por cima só por causa de uma
// corrida entre o webhook e esta varredura). Reaproveita o MESMO status SUSPENDED
// já usado por inadimplência (nunca introduz um novo valor em `TenantStatus`, que
// já é checado em dezenas de lugares — ver nota em
// `middlewares/tenant-lockout.middleware.ts`), distinguido apenas por
// `Tenant.suspensionReason = "TRIAL_EXPIRED"`.
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, trialExpiryEnforcementQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";
import { notifyTenant } from "../modules/notifications/notify.service";
import { computeTenantPurgeAt } from "../lib/tenant-purge";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("trial-expiry-enforcement");

const REPEATABLE_JOB_NAME = "daily-sweep";
const DAILY_CRON_330AM = "30 3 * * *";

export async function trialExpiryEnforcementProcessor(_job: Job): Promise<{ expired: number }> {
  const now = new Date();

  const expiredTrialTenants = await prismaUnscoped.tenant.findMany({
    where: { status: "TRIAL", trialEndsAt: { lte: now } },
    select: { id: true },
  });

  let expired = 0;
  for (const tenant of expiredTrialTenants) {
    // Checagem defensiva: nunca suspende por cima de uma assinatura paga
    // confirmada (ver nota de cabeçalho acima).
    const hasPaidSubscription = await prismaUnscoped.subscription.findFirst({
      where: { tenantId: tenant.id, status: { in: ["ACTIVE", "PAST_DUE"] } },
      select: { id: true },
    });
    if (hasPaidSubscription) {
      log.warn({ tenantId: tenant.id }, "tenant TRIAL com trialEndsAt vencido mas já possui assinatura paga — pulando (provável corrida com o webhook de confirmação)");
      continue;
    }

    try {
      const suspendedAt = now;
      await prismaUnscoped.tenant.update({
        where: { id: tenant.id },
        data: {
          status: "SUSPENDED",
          suspensionReason: "TRIAL_EXPIRED",
          suspendedAt,
          purgeAt: computeTenantPurgeAt(suspendedAt),
        },
      });

      await notifyTenant({
        tenantId: tenant.id,
        category: "BILLING_DUNNING",
        severity: "CRITICAL",
        title: "Período de teste expirado",
        body: "Seu período de teste gratuito expirou sem a contratação de um plano pago. O acesso ao sistema foi suspenso — contrate um plano para continuar usando o Filitech ERP.",
        linkRoute: "/configuracoes/cobranca",
        sourceType: "TENANT",
        sourceId: tenant.id,
      });

      expired += 1;
    } catch (error) {
      log.error({ tenantId: tenant.id, err: error }, "falha ao suspender tenant com trial SaaS expirado — tentará de novo na próxima varredura");
    }
  }

  if (expired > 0) {
    log.info({ expired }, "tenants com trial SaaS expirado foram suspensos");
  }

  return { expired };
}

export function startTrialExpiryEnforcementWorker(): Worker {
  return new Worker(QUEUE_NAMES.TRIAL_EXPIRY_ENFORCEMENT, trialExpiryEnforcementProcessor, {
    connection: queueRedisConnection,
    // Mesmo princípio de concorrência explícita de suspend-overdue-tenants.worker.ts:
    // job único diário cujo processor já itera todos os tenants elegíveis num `for`
    // sequencial — nunca há dois jobs desta fila concorrentes.
    concurrency: 1,
  });
}

export async function scheduleTrialExpiryEnforcementJob(): Promise<void> {
  await trialExpiryEnforcementQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_330AM },
    { name: REPEATABLE_JOB_NAME, opts: DEFAULT_RECURRING_JOB_OPTS },
  );
}
