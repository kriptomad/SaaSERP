// apps/api/src/workers/data-retention-purge.worker.ts
// fa-w4-lgpd-no-retention-purge — Antes deste worker, NENHUM mecanismo geral de
// retenção/expurgo de PII existia no sistema (apenas casos pontuais e não-PII como
// `expire-loyalty-points.worker.ts` e `expire-stale-pending-checkouts.worker.ts`).
//
// ESCOPO DELIBERADAMENTE CONSERVADOR: este worker expurga APENAS os artefatos ZIP
// de exportação LGPD (`TenantDataExportJob`/"DataExport") já concluídos há mais de
// `EXPORT_RETENTION_DAYS` dias — um artefato que o próprio titular dos dados pediu
// e já teve (presumivelmente) tempo de sobra para baixar. Isso é seguro de
// automatizar porque (a) o ZIP é só uma CÓPIA derivada de dados que continuam
// intactos nas tabelas operacionais, e (b) mantê-lo indefinidamente no R2 é, em si,
// uma cópia extra de PII sem função de negócio — exatamente o tipo de risco que a
// LGPD (Art. 16) pede para minimizar.
//
// NÃO fazemos aqui (de propósito): qualquer expurgo/anonimização automática de
// registros de negócio "ao vivo" (Client, Sale, PrescriptionRecord, WorkOrder,
// lançamentos financeiros/contábeis etc.). Prazos de retenção legal desses dados
// variam por categoria (ex.: obrigações fiscais/contábeis no Brasil frequentemente
// exigem 5+ anos; prontuários/prescrições podem ter prazos sanitários próprios) e
// definir isso errado por decisão unilateral de engenharia em uma auditoria é pior
// do que não ter o fix: um prazo curto demais destruiria registros exigidos por
// lei, e isso não é reversível. Essa decisão de política de retenção por
// categoria de dado deve vir do time de negócio/jurídico do Filitech, não ser
// inventada aqui. O fluxo de "direito à eliminação" sob pedido explícito do titular
// (anonimização gated por aprovação) já existe separadamente em
// `data-deletion-processing.worker.ts` — este worker aqui é só limpeza automática
// de uma cópia derivada temporária, não eliminação de dados de negócio.
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, dataRetentionPurgeQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";
import { deleteObjectDirect } from "../lib/object-storage";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("data-retention-purge");

const REPEATABLE_JOB_NAME = "daily-sweep";
const DAILY_CRON_4AM = "0 4 * * *";
const EXPORT_RETENTION_DAYS = 30;
const EXPORT_RETENTION_MS = EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export async function dataRetentionPurgeProcessor(_job: Job): Promise<{ purgedExports: number }> {
  const threshold = new Date(Date.now() - EXPORT_RETENTION_MS);

  const expiredExports = await prismaUnscoped.tenantDataExportJob.findMany({
    where: {
      status: "COMPLETED",
      purgedAt: null,
      completedAt: { lte: threshold },
      resultStorageKey: { not: null },
    },
    select: { id: true, tenantId: true, resultStorageKey: true },
  });

  let purgedExports = 0;
  for (const exportJob of expiredExports) {
    try {
      if (exportJob.resultStorageKey) {
        await deleteObjectDirect(exportJob.resultStorageKey);
      }
      await prismaUnscoped.tenantDataExportJob.update({
        where: { id: exportJob.id },
        data: { purgedAt: new Date(), resultStorageKey: null },
      });
      purgedExports += 1;
    } catch (error) {
      log.error(
        { exportJobId: exportJob.id, tenantId: exportJob.tenantId, err: error },
        "falha ao expurgar artefato de exportação LGPD expirado — tentará de novo na próxima varredura",
      );
    }
  }

  if (purgedExports > 0) {
    log.info({ purgedExports }, "artefatos de exportação LGPD expirados (>30 dias) foram expurgados do R2");
  }

  return { purgedExports };
}

export function startDataRetentionPurgeWorker(): Worker {
  return new Worker(QUEUE_NAMES.DATA_RETENTION_PURGE, dataRetentionPurgeProcessor, {
    connection: queueRedisConnection,
    // CORREÇÃO DE AUDITORIA (fa-w5-perf-worker-default-concurrency): job único
    // agendado (`upsertJobScheduler`, mesmo `REPEATABLE_JOB_NAME` todo dia) cujo
    // processor percorre internamente TODOS os exports LGPD expirados do sistema
    // inteiro num `for` sequencial — nunca há um segundo job desta fila concorrente
    // para `concurrency` paralelizar. Explicitado em 1 (antes implícito) para que
    // uma eventual sobreposição de duas execuções do mesmo job (redeploy lento)
    // nunca rode em paralelo e tente deletar o mesmo artefato do R2 duas vezes.
    concurrency: 1,
  });
}

export async function scheduleDataRetentionPurgeJob(): Promise<void> {
  await dataRetentionPurgeQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_4AM },
    { name: REPEATABLE_JOB_NAME, opts: DEFAULT_RECURRING_JOB_OPTS },
  );
}
