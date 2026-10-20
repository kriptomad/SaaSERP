// apps/api/src/workers/dunning-milestone-dispatch.worker.ts
// fa-w6-bl-dunning-not-durable — ver nota de design completa em schema.prisma,
// model `DunningMilestone`. Este worker consome DOIS tipos de job na MESMA fila:
//
// 1. "dispatch-milestone" (sob demanda, enfileirado por dunning.service.ts logo
//    após o commit da transação que gravou o `DunningMilestone` com
//    status=PENDING): entrega a notificação de fato via `notifyTenant`, com o
//    attempts/backoff do BullMQ já cobrindo falhas transitórias — ao contrário do
//    antigo `try { await notifyTenant(...) } catch { log.error(...) }` inline em
//    dunning.service.ts, uma falha aqui NUNCA é silenciosamente descartada: o job
//    é automaticamente retentado pelo BullMQ, e só marca o milestone como FAILED
//    (nunca reverte para PENDING) após esgotar todas as tentativas — nesse ponto
//    ele ainda fica disponível para a reconciliação abaixo decidir se tenta de novo
//    manualmente/por um operador.
// 2. "reconcile-pending-milestones" (cron diário): rede de segurança para o caso
//    em que o PRÓPRIO enfileiramento do job 1 falhe de forma síncrona (ex.: Redis
//    momentaneamente fora do ar bem no instante em que dunning.service.ts tenta
//    enfileirar, logo após o commit) — o milestone fica PENDING no Postgres
//    indefinidamente sem isso. Reenfileira qualquer milestone PENDING mais antigo
//    que um pequeno limiar de tolerância (nunca compete com o job recém-criado que
//    ainda está no meio do seu próprio fluxo normal).
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, dunningMilestoneDispatchQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";
import { notifyTenant } from "../modules/notifications/notify.service";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("dunning-milestone-dispatch");

const RECONCILE_JOB_NAME = "reconcile-pending-milestones";
const EVERY_10_MINUTES_CRON = "*/10 * * * *";
// Margem de segurança: um dispatch normal entrega em segundos; 10 minutos é tempo
// de sobra para nunca competir com um job recém-enfileirado ainda em andamento.
const PENDING_TOLERANCE_MS = 10 * 60 * 1000;
const MAX_RECONCILE_PER_SCAN = 200;

type DunningMilestonePayload = { attempt?: number; nextRetryAt?: string; reason?: string };

async function dispatchMilestoneNotification(milestoneId: string): Promise<void> {
  const milestone = await prismaUnscoped.dunningMilestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) {
    log.warn({ milestoneId }, "dunning milestone não encontrado — pode já ter sido removido/reprocessado, pulando");
    return;
  }
  if (milestone.status === "SENT") {
    // Idempotência: reconciliação/retry tardio de um milestone que já foi
    // entregue com sucesso (ex.: o worker commitou SENT mas o ack do job ao
    // Redis se perdeu, fazendo o BullMQ reentregar) — nunca notifica duas vezes.
    return;
  }

  const payload = milestone.payload as DunningMilestonePayload;

  try {
    if (milestone.type === "PAYMENT_FAILED") {
      const attempt = payload.attempt ?? 1;
      const nextRetryAt = payload.nextRetryAt ? new Date(payload.nextRetryAt) : new Date();
      await notifyTenant({
        tenantId: milestone.tenantId,
        category: "BILLING_DUNNING",
        title: "Falha no pagamento da assinatura",
        body: `Tentativa ${attempt} de cobrança falhou. Próxima tentativa em ${nextRetryAt.toLocaleDateString("pt-BR")}.`,
        severity: attempt >= 3 ? "CRITICAL" : "WARNING",
        linkRoute: "/configuracoes/cobranca",
        sourceType: "SUBSCRIPTION",
        sourceId: milestone.subscriptionId,
        requestId: milestone.requestId ?? undefined,
      });
    } else if (milestone.type === "SUBSCRIPTION_CANCELED") {
      await notifyTenant({
        tenantId: milestone.tenantId,
        category: "BILLING_DUNNING",
        severity: "CRITICAL",
        title: "Assinatura cancelada",
        body: "Sua assinatura foi cancelada junto ao provedor de pagamento e o acesso ao sistema foi suspenso. Reative o plano para continuar usando o Filitech ERP.",
        linkRoute: "/configuracoes/cobranca",
        sourceType: "SUBSCRIPTION",
        sourceId: milestone.subscriptionId,
        requestId: milestone.requestId ?? undefined,
      });
    } else if (milestone.type === "PAYMENT_REVERSED") {
      const reason = payload.reason === "CHARGEBACK" ? "CHARGEBACK" : "REFUNDED";
      await notifyTenant({
        tenantId: milestone.tenantId,
        category: "BILLING_DUNNING",
        severity: "CRITICAL",
        title: reason === "CHARGEBACK" ? "Cobrança contestada (chargeback)" : "Pagamento estornado",
        body:
          reason === "CHARGEBACK"
            ? "O pagamento da sua assinatura foi contestado junto à operadora do cartão e o acesso ao sistema foi suspenso. Entre em contato com o suporte para regularizar."
            : "O pagamento da sua assinatura foi estornado e o acesso ao sistema foi suspenso. Realize um novo pagamento para reativar.",
        linkRoute: "/configuracoes/cobranca",
        sourceType: "SUBSCRIPTION",
        sourceId: milestone.subscriptionId,
        requestId: milestone.requestId ?? undefined,
      });
    }

    await prismaUnscoped.dunningMilestone.update({ where: { id: milestone.id }, data: { status: "SENT", processedAt: new Date() } });
  } catch (error) {
    // Deixa o BullMQ reentregar (propaga a exceção) — só marca FAILED quando esta
    // for a ÚLTIMA tentativa configurada no job (ver `dunningMilestoneDispatchProcessor`).
    throw error;
  }
}

export async function dunningMilestoneDispatchProcessor(job: Job): Promise<void> {
  if (job.name === RECONCILE_JOB_NAME) {
    const staleThreshold = new Date(Date.now() - PENDING_TOLERANCE_MS);
    const stalePending = await prismaUnscoped.dunningMilestone.findMany({
      where: { status: "PENDING", createdAt: { lte: staleThreshold } },
      select: { id: true },
      take: MAX_RECONCILE_PER_SCAN,
    });
    for (const milestone of stalePending) {
      await dunningMilestoneDispatchQueue.add(
        "dispatch-milestone",
        { milestoneId: milestone.id },
        { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
      );
    }
    if (stalePending.length > 0) {
      log.info({ reenqueued: stalePending.length }, "reconciliação encontrou dunning milestones PENDING sem job ativo e os reenfileirou");
    }
    return;
  }

  const { milestoneId } = job.data as { milestoneId: string };
  try {
    await dispatchMilestoneNotification(milestoneId);
  } catch (error) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      // Esgotou todas as tentativas do BullMQ — marca FAILED (nunca silenciosamente
      // perdido: o milestone continua consultável/reprocessável manualmente).
      await prismaUnscoped.dunningMilestone
        .update({ where: { id: milestoneId }, data: { status: "FAILED", processedAt: new Date() } })
        .catch((updateErr) => log.error({ milestoneId, err: updateErr }, "falha ao marcar dunning milestone como FAILED após esgotar tentativas"));
    }
    throw error;
  }
}

export function startDunningMilestoneDispatchWorker(): Worker {
  return new Worker(QUEUE_NAMES.DUNNING_MILESTONE_DISPATCH, dunningMilestoneDispatchProcessor, {
    connection: queueRedisConnection,
    concurrency: 5,
  });
}

export async function scheduleDunningMilestoneReconciliationJob(): Promise<void> {
  await dunningMilestoneDispatchQueue.upsertJobScheduler(
    RECONCILE_JOB_NAME,
    { pattern: EVERY_10_MINUTES_CRON },
    { name: RECONCILE_JOB_NAME, opts: DEFAULT_RECURRING_JOB_OPTS },
  );
}
