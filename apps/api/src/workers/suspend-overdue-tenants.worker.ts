// apps/api/src/workers/suspend-overdue-tenants.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.4 (fila `suspend-overdue-tenants`) e
// Capítulo 2.7.4 (régua de dunning) — rede de segurança diária: a suspensão
// primária já acontece de forma reativa em dunning.service.ts (4ª tentativa
// falha de cobrança), mas se um webhook de retry for perdido (timeout, SEFAZ/
// provedor fora do ar, etc.), este job varre diariamente qualquer tenant com
// `status = PAST_DUE` cujo `gracePeriodEndsAt` já passou e força a suspensão,
// garantindo que nenhum tenant inadimplente continue ativo indefinidamente por
// falha de infraestrutura externa ao Filitech.
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, suspendOverdueTenantsQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";
import { notifyTenant } from "../modules/notifications/notify.service";

const REPEATABLE_JOB_NAME = "daily-sweep";
const DAILY_CRON_3AM = "0 3 * * *";

export async function suspendOverdueTenantsProcessor(_job: Job): Promise<{ suspended: number }> {
  const now = new Date();

  const overdueTenants = await prismaUnscoped.tenant.findMany({
    where: { status: "PAST_DUE", gracePeriodEndsAt: { lte: now } },
    select: { id: true },
  });

  let suspended = 0;
  for (const tenant of overdueTenants) {
    await prismaUnscoped.$transaction([
      prismaUnscoped.tenant.update({ where: { id: tenant.id }, data: { status: "SUSPENDED" } }),
      prismaUnscoped.subscription.updateMany({
        where: { tenantId: tenant.id, status: { not: "SUSPENDED" } },
        data: { status: "SUSPENDED" },
      }),
    ]);

    await notifyTenant({
      tenantId: tenant.id,
      category: "BILLING_DUNNING",
      severity: "CRITICAL",
      title: "Conta suspensa por inadimplência",
      body: "O prazo de regularização da sua assinatura expirou e o acesso ao sistema foi suspenso. Regularize o pagamento para reativar.",
      linkRoute: "/configuracoes/cobranca",
      sourceType: "SUBSCRIPTION",
      sourceId: tenant.id,
    });

    suspended += 1;
  }

  return { suspended };
}

export function startSuspendOverdueTenantsWorker(): Worker {
  return new Worker(QUEUE_NAMES.SUSPEND_OVERDUE_TENANTS, suspendOverdueTenantsProcessor, {
    connection: queueRedisConnection,
    // CORREÇÃO DE AUDITORIA (fa-w5-perf-worker-default-concurrency): job diário
    // único cujo processor já itera TODOS os tenants PAST_DUE vencidos num `for`
    // sequencial dentro da mesma execução — nunca há dois jobs desta fila
    // concorrentes. `concurrency: 1` explicitado (antes implícito).
    concurrency: 1,
  });
}

// Agendamento idempotente: BullMQ ignora `upsertJobScheduler` repetido com o mesmo
// identificador, então chamar isso na inicialização do worker é seguro mesmo
// após restarts/deploys (não duplica o job repetível).
export async function scheduleSuspendOverdueTenantsJob(): Promise<void> {
  await suspendOverdueTenantsQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_3AM },
    { name: REPEATABLE_JOB_NAME, opts: DEFAULT_RECURRING_JOB_OPTS },
  );
}
