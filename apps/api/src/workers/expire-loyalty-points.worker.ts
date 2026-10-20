// apps/api/src/workers/expire-loyalty-points.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.1.1 — Fidelidade: expiração rolante de
// pontos (`LoyaltyProgram.pointsExpireAfterDays`). GAP DE AUDITORIA FECHADO (Rodada
// 15): `LoyaltyTransaction.expiresAt` já era gravado em todo lançamento EARN
// (accrue-loyalty-points.service.ts), e o enum `LoyaltyTransactionType.EXPIRE` já
// existia desde o início do schema com o comentário "pontos expirados
// automaticamente pelo job de expiração" — mas nenhum job jamais consumia esse
// campo: pontos vencidos continuavam resgatáveis para sempre.
//
// `LoyaltyAccount.pointsBalance` é um saldo único, sem rastreio de QUAL lote EARN
// ainda está em aberto — mesma limitação estrutural documentada em
// liquor-ledger.routes.ts para cascos retornáveis. A solução é a mesma aproximação
// FIFO: para cada conta, reconstrói cronologicamente uma fila de lotes EARN
// {points, expiresAt}; cada REDEEM/EXPIRE/ajuste negativo consome a quantidade das
// entradas EARN mais antigas ainda não compensadas. O que sobra na fila com
// `expiresAt` no passado é expirado nesta varredura.
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, loyaltyPointsExpirationQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";

const REPEATABLE_JOB_NAME = "daily-sweep";
// 04:00 — depois da varredura de inadimplência (03:00, suspend-overdue-tenants.worker.ts),
// fora do horário comercial de qualquer fuso horário brasileiro.
const DAILY_CRON_4AM = "0 4 * * *";

interface Batch {
  points: number;
  expiresAt: Date | null;
}

export async function expireLoyaltyPointsProcessor(_job: Job): Promise<{ accountsExpired: number; pointsExpired: number }> {
  const now = new Date();

  // Só percorre contas que de fato têm pelo menos um lançamento EARN já vencido —
  // usa o índice `@@index([expiresAt])` do schema para não varrer toda a base de
  // LoyaltyTransaction de todos os tenants a cada execução diária.
  const candidateAccountIds = await prismaUnscoped.loyaltyTransaction.findMany({
    where: { type: "EARN", expiresAt: { lte: now } },
    select: { loyaltyAccountId: true },
    distinct: ["loyaltyAccountId"],
  });

  let accountsExpired = 0;
  let pointsExpired = 0;

  for (const { loyaltyAccountId } of candidateAccountIds) {
    const transactions = await prismaUnscoped.loyaltyTransaction.findMany({
      where: { loyaltyAccountId },
      orderBy: { createdAt: "asc" },
    });

    const queue: Batch[] = [];
    for (const txn of transactions) {
      if (txn.type === "EARN") {
        queue.push({ points: txn.points, expiresAt: txn.expiresAt });
        continue;
      }
      // REDEEM/EXPIRE/MANUAL_ADJUST negativo consomem a fila FIFO; MANUAL_ADJUST
      // positivo (bônus do gerente) não tem data de expiração própria e por isso
      // nunca entra na fila — fica fora do escopo de expiração automática.
      let remaining = Math.abs(txn.points);
      while (remaining > 0 && queue.length > 0) {
        const front = queue[0];
        if (front.points <= remaining) {
          remaining -= front.points;
          queue.shift();
        } else {
          front.points -= remaining;
          remaining = 0;
        }
      }
    }

    const totalExpired = queue.filter((batch) => batch.expiresAt && batch.expiresAt <= now).reduce((sum, b) => sum + b.points, 0);
    if (totalExpired <= 0) continue;

    await prismaUnscoped.$transaction(async (tx) => {
      // Guard atômico `pointsBalance >= totalExpired` no WHERE: se um resgate
      // concorrente já consumiu esses pontos entre a leitura e esta escrita, a
      // atualização afeta 0 linhas e nada é expirado nesta execução — a próxima
      // varredura diária recalcula do zero com o histórico já atualizado,
      // nunca duplicando nem derrubando o saldo para negativo.
      const updated = await tx.loyaltyAccount.updateMany({
        where: { id: loyaltyAccountId, pointsBalance: { gte: totalExpired } },
        data: { pointsBalance: { decrement: totalExpired } },
      });
      if (updated.count === 0) return;

      await tx.loyaltyTransaction.create({
        data: {
          loyaltyAccountId,
          type: "EXPIRE",
          points: -totalExpired,
          reason: `Expiração automática de ${totalExpired} ponto(s) vencido(s) (varredura diária).`,
        },
      });
    });

    accountsExpired += 1;
    pointsExpired += totalExpired;
  }

  return { accountsExpired, pointsExpired };
}

export function startExpireLoyaltyPointsWorker(): Worker {
  return new Worker(QUEUE_NAMES.LOYALTY_POINTS_EXPIRATION, expireLoyaltyPointsProcessor, {
    connection: queueRedisConnection,
  });
}

// Agendamento idempotente — mesmo padrão de scheduleSuspendOverdueTenantsJob.
export async function scheduleExpireLoyaltyPointsJob(): Promise<void> {
  await loyaltyPointsExpirationQueue.upsertJobScheduler(REPEATABLE_JOB_NAME, { pattern: DAILY_CRON_4AM }, { name: REPEATABLE_JOB_NAME, opts: DEFAULT_RECURRING_JOB_OPTS });
}
