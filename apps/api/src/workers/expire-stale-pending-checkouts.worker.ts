// apps/api/src/workers/expire-stale-pending-checkouts.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 9.3 — rede de segurança para
// `Subscription.status = PENDING_CHECKOUT` que nunca avançou para ACTIVE (webhook
// de confirmação nunca chegou) nem foi limpa de forma síncrona em
// `checkout.routes.ts` (que, desde a mega-audit rodada 7, deliberadamente NÃO
// apaga a linha quando o erro do provedor é ambíguo — timeout/conexão caída antes
// de qualquer resposta — pois o checkout pode ter sido criado do lado do provedor
// mesmo sem confirmação para nós). Sem este job, uma linha PENDING_CHECKOUT órfã
// (por erro ambíguo OU por o lojista simplesmente nunca voltar para pagar)
// ficaria para sempre, e o cupom eventualmente aplicado a ela nunca seria
// devolvido.
//
// Janela de 24h: tempo generoso para um webhook atrasado ainda chegar e promover a
// Subscription para ACTIVE antes da varredura — depois disso, consideramos o
// checkout definitivamente abandonado.
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, expireStalePendingCheckoutsQueue } from "../lib/queue";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("expire-stale-pending-checkouts");

const REPEATABLE_JOB_NAME = "daily-sweep";
const DAILY_CRON_5AM = "0 5 * * *";
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export async function expireStalePendingCheckoutsProcessor(_job: Job): Promise<{ expired: number }> {
  const threshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const stale = await prismaUnscoped.subscription.findMany({
    where: { status: "PENDING_CHECKOUT", createdAt: { lte: threshold } },
    select: { id: true, tenantId: true, pendingCouponId: true },
  });

  let expired = 0;
  for (const subscription of stale) {
    try {
      await prismaUnscoped.$transaction(async (tx) => {
        if (subscription.pendingCouponId) {
          await tx.discountCoupon.update({ where: { id: subscription.pendingCouponId }, data: { redemptionCount: { decrement: 1 } } }).catch(() => undefined);
        }
        await tx.subscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
      });
      expired += 1;
    } catch (error) {
      log.error({ subscriptionId: subscription.id, tenantId: subscription.tenantId, err: error }, "falha ao expirar checkout pendente travado — tentará de novo na próxima varredura");
    }
  }

  if (expired > 0) {
    log.info({ expired }, "checkouts PENDING_CHECKOUT abandonados há mais de 24h foram expirados");
  }

  return { expired };
}

export function startExpireStalePendingCheckoutsWorker(): Worker {
  return new Worker(QUEUE_NAMES.EXPIRE_STALE_PENDING_CHECKOUTS, expireStalePendingCheckoutsProcessor, {
    connection: queueRedisConnection,
  });
}

export async function scheduleExpireStalePendingCheckoutsJob(): Promise<void> {
  await expireStalePendingCheckoutsQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_5AM },
    { name: REPEATABLE_JOB_NAME },
  );
}
