// apps/api/src/worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3 — topologia "API Node.js xN | BullMQ Workers":
// processo Node.js dedicado, separado da API HTTP, que consome as filas BullMQ.
// Iniciado via `npm run worker` (ver package.json), nunca dentro do processo do Express.
import "dotenv/config";
import { createModuleLogger } from "./lib/logger";
import { initSentry, Sentry } from "./lib/sentry";
import { installProcessCrashGuards } from "./lib/process-guards";
import { startSuspendOverdueTenantsWorker, scheduleSuspendOverdueTenantsJob } from "./workers/suspend-overdue-tenants.worker";
import { startFiscalEmissionWorker } from "./workers/fiscal-emission.worker";
import { startWhatsAppNotificationsWorker } from "./workers/whatsapp-notifications.worker";
import { startSmsNotificationsWorker } from "./workers/sms-notifications.worker";
import { startPluggySyncWorker } from "./workers/pluggy-sync.worker";
import { startExpireLoyaltyPointsWorker, scheduleExpireLoyaltyPointsJob } from "./workers/expire-loyalty-points.worker";
import { startEnforceScheduledCancellationsWorker, scheduleEnforceScheduledCancellationsJob } from "./workers/enforce-scheduled-cancellations.worker";
import { startWebhookDeliveryWorker } from "./workers/webhook-delivery.worker";
import { startPersonalRecurrenceGenerationWorker, schedulePersonalRecurrenceGenerationJob } from "./workers/personal-recurrence-generation.worker";
import { startPersonalBillRemindersWorker, schedulePersonalBillRemindersJob } from "./workers/personal-bill-reminders.worker";
import { startDataExportGenerationWorker } from "./workers/data-export-generation.worker";
import { startDataImportValidationWorker } from "./workers/data-import-validation.worker";
import { startDataImportExecutionWorker } from "./workers/data-import-execution.worker";
import { startEncryptedDatabaseBackupWorker, scheduleEncryptedDatabaseBackupJob } from "./workers/encrypted-database-backup.worker";
import { startScheduledReportGenerationWorker, syncScheduledReportJobSchedulers } from "./workers/scheduled-report-generation.worker";
import { startPersonalInvestmentQuotesWorker, schedulePersonalInvestmentQuotesJob } from "./workers/personal-investment-quotes.worker";
import { startAccountingRecurringTasksWorker, scheduleAccountingRecurringTasksJob } from "./workers/accounting-recurring-tasks.worker";
import { startFetchIncomingNfeWorker, scheduleFetchIncomingNfeJob } from "./workers/fetch-incoming-nfe.worker";
import { startReconcileStuckFiscalDocumentsWorker, scheduleReconcileStuckFiscalDocumentsJob } from "./workers/reconcile-stuck-fiscal-documents.worker";
import { startExpireStalePendingCheckoutsWorker, scheduleExpireStalePendingCheckoutsJob } from "./workers/expire-stale-pending-checkouts.worker";
import { startAccountingDocumentGenerationWorker } from "./workers/accounting-document-generation.worker";
import { startReportExportGenerationWorker } from "./workers/report-export-generation.worker";
import { startDataDeletionProcessingWorker } from "./workers/data-deletion-processing.worker";
import { startDataRetentionPurgeWorker, scheduleDataRetentionPurgeJob } from "./workers/data-retention-purge.worker";
import { startReconcileStuckProcessingJobsWorker, scheduleReconcileStuckProcessingJobsJob } from "./workers/reconcile-stuck-processing-jobs.worker";
import { prismaUnscoped } from "@filitech/db";

async function main() {
  // fa-w4-obs-no-error-tracking-apm / fa-w4-obs-no-crash-handlers-worker: mesmo
  // mecanismo de server.ts (process-guards.ts compartilhado) — este processo não
  // tem Express, mas um bug não tratado num job BullMQ pode igualmente lançar uma
  // exceção síncrona ou deixar uma Promise sem `.catch`, derrubando/zumbificando o
  // processo de workers inteiro sem nenhuma pista.
  initSentry("filitech-worker");
  installProcessCrashGuards("filitech-worker");

  const log = createModuleLogger("worker");
  const suspendOverdueTenantsWorker = startSuspendOverdueTenantsWorker();
  await scheduleSuspendOverdueTenantsJob();
  const fiscalEmissionWorker = startFiscalEmissionWorker();
  const whatsappNotificationsWorker = startWhatsAppNotificationsWorker();
  const smsNotificationsWorker = startSmsNotificationsWorker();
  const pluggySyncWorker = startPluggySyncWorker();
  const expireLoyaltyPointsWorker = startExpireLoyaltyPointsWorker();
  await scheduleExpireLoyaltyPointsJob();
  const enforceScheduledCancellationsWorker = startEnforceScheduledCancellationsWorker();
  await scheduleEnforceScheduledCancellationsJob();
  const webhookDeliveryWorker = startWebhookDeliveryWorker();
  const personalRecurrenceGenerationWorker = startPersonalRecurrenceGenerationWorker();
  await schedulePersonalRecurrenceGenerationJob();
  const personalBillRemindersWorker = startPersonalBillRemindersWorker();
  await schedulePersonalBillRemindersJob();
  // Capítulo 18.4/18.5 — jobs sob demanda (não repetíveis), por isso sem
  // `schedule*Job()` equivalente ao dos workers acima.
  const dataExportGenerationWorker = startDataExportGenerationWorker();
  const dataImportValidationWorker = startDataImportValidationWorker();
  const dataImportExecutionWorker = startDataImportExecutionWorker();
  const encryptedDatabaseBackupWorker = startEncryptedDatabaseBackupWorker();
  await scheduleEncryptedDatabaseBackupJob();
  const scheduledReportGenerationWorker = startScheduledReportGenerationWorker();
  await syncScheduledReportJobSchedulers();
  const personalInvestmentQuotesWorker = startPersonalInvestmentQuotesWorker();
  await schedulePersonalInvestmentQuotesJob();
  const accountingRecurringTasksWorker = startAccountingRecurringTasksWorker();
  await scheduleAccountingRecurringTasksJob();
  const fetchIncomingNfeWorker = startFetchIncomingNfeWorker();
  await scheduleFetchIncomingNfeJob();
  const reconcileStuckFiscalDocumentsWorker = startReconcileStuckFiscalDocumentsWorker();
  await scheduleReconcileStuckFiscalDocumentsJob();
  const expireStalePendingCheckoutsWorker = startExpireStalePendingCheckoutsWorker();
  await scheduleExpireStalePendingCheckoutsJob();
  // fa-perf-accounting-doc-generation-inline / fa-perf-report-export-inline — jobs
  // sob demanda (não repetíveis), mesmo padrão dos demais acima.
  const accountingDocumentGenerationWorker = startAccountingDocumentGenerationWorker();
  const reportExportGenerationWorker = startReportExportGenerationWorker();
  // fa-w4-lgpd-no-deletion-workflow — job sob demanda (não repetível), mesmo
  // padrão do grupo acima.
  const dataDeletionProcessingWorker = startDataDeletionProcessingWorker();
  // fa-w4-lgpd-no-retention-purge — varredura diária de expurgo de artefatos de
  // exportação LGPD expirados.
  const dataRetentionPurgeWorker = startDataRetentionPurgeWorker();
  await scheduleDataRetentionPurgeJob();
  // fa-w4-stale-intermediate-status-reaper — varredura periódica de
  // DataImportJob/TenantDataExportJob/ReportExportJob travados em status
  // intermediário, mesmo princípio de `reconcileStuckFiscalDocumentsWorker` acima.
  const reconcileStuckProcessingJobsWorker = startReconcileStuckProcessingJobsWorker();
  await scheduleReconcileStuckProcessingJobsJob();

  // fa-w4-worker-listeners-incomplete: ÚNICA fonte de verdade da lista de workers
  // deste processo — usada tanto para registrar os listeners `completed`/`failed`
  // quanto para o graceful shutdown abaixo. Antes desta correção existiam DUAS
  // listas mantidas manualmente (uma só para listeners, outra só para shutdown) que
  // já haviam divergido na prática: `reconcileStuckFiscalDocumentsWorker` e
  // `expireStalePendingCheckoutsWorker` estavam no array de shutdown mas NÃO no de
  // listeners, então uma falha nesses dois workers específicos nunca era logada
  // nem gerava alerta/registro de DLQ — só o `Worker.close()` deles rodava
  // corretamente no shutdown. Uma única lista elimina a possibilidade de uma
  // futura adição de worker esquecer de repetir o nome em dois lugares.
  const allWorkers = [
    suspendOverdueTenantsWorker,
    fiscalEmissionWorker,
    whatsappNotificationsWorker,
    smsNotificationsWorker,
    pluggySyncWorker,
    expireLoyaltyPointsWorker,
    enforceScheduledCancellationsWorker,
    webhookDeliveryWorker,
    personalRecurrenceGenerationWorker,
    personalBillRemindersWorker,
    dataExportGenerationWorker,
    dataImportValidationWorker,
    dataImportExecutionWorker,
    encryptedDatabaseBackupWorker,
    scheduledReportGenerationWorker,
    personalInvestmentQuotesWorker,
    accountingRecurringTasksWorker,
    fetchIncomingNfeWorker,
    reconcileStuckFiscalDocumentsWorker,
    expireStalePendingCheckoutsWorker,
    accountingDocumentGenerationWorker,
    reportExportGenerationWorker,
    dataDeletionProcessingWorker,
    dataRetentionPurgeWorker,
    reconcileStuckProcessingJobsWorker,
  ];

  for (const worker of allWorkers) {
    worker.on("completed", (job) => {
      // fa-w4-obs-no-request-id: quando o produtor do job propagou `requestId` no
      // payload (fiscal emission, data/report export, webhook delivery — ver
      // respectivos produtores), este log fica correlacionável com o log da
      // requisição HTTP original que o enfileirou.
      const requestId = (job.data as { requestId?: string } | undefined)?.requestId;
      log.info({ queue: job.queueName, jobId: job.id, requestId, result: job.returnvalue }, "job concluído");
    });

    worker.on("failed", (job, error) => {
      const requestId = (job?.data as { requestId?: string } | undefined)?.requestId;
      log.error({ queue: job?.queueName, jobId: job?.id, requestId, err: error }, "job falhou");

      // fa-w4-obs-no-queue-failure-alerting: falha TERMINAL (esgotou todas as
      // `attempts` configuradas no `queue.add(...)` do produtor — não haverá mais
      // nenhum retry automático do BullMQ para este job) é um evento
      // qualitativamente diferente de uma falha intermediária que ainda vai
      // retentar sozinha. Loga em `fatal` com um marcador bem distinto
      // (`alert: true`) para ser trivial de filtrar/encaminhar para um canal de
      // alerta externo (PagerDuty/Slack/e-mail de plantão) no agregador de logs —
      // sem isso, um job que falha pra sempre (ex.: emissão fiscal travada,
      // webhook de um tenant permanentemente fora do ar, exportação de relatório
      // quebrada) só aparecia como mais uma linha de `error` igual a qualquer
      // tentativa intermediária, indistinguível sem abrir o painel do BullMQ.
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? 1;
      const isTerminalFailure = job != null && attemptsMade >= maxAttempts;
      if (isTerminalFailure) {
        log.fatal(
          {
            alert: true,
            queue: job.queueName,
            jobId: job.id,
            requestId,
            attemptsMade,
            maxAttempts,
            err: error,
          },
          "ALERTA: job esgotou todas as tentativas e falhou definitivamente (sem mais retry automático)",
        );
        Sentry.captureException(error, {
          tags: { queue: job.queueName, terminalFailure: "true" },
          extra: { jobId: job.id, requestId, attemptsMade, maxAttempts },
        });

        // fa-w4-queue-no-dlq: além do log/Sentry acima (voláteis, difíceis de
        // consultar depois de um tempo), persiste um registro DURÁVEL no Postgres
        // — nenhuma falha terminal de job (ex.: emissão fiscal após as 5 tentativas
        // configuradas, deixando o FiscalDocument travado em PENDING) pode ficar
        // sem nenhum rastro consultável fora do agregador de log/Redis (que já
        // poda jobs falhos antigos via `removeOnFail`, fa-w4-queue-unbounded-retention).
        // `tenantId` é extraído do payload do job quando presente — nem todo job
        // é tenant-scoped (ex.: `suspend-overdue-tenants`, `database-backup` são
        // platform-wide), por isso a coluna é nullable.
        const tenantId = (job.data as { tenantId?: string } | undefined)?.tenantId ?? null;
        prismaUnscoped.workerJobFailure
          .create({
            data: {
              tenantId,
              queueName: job.queueName,
              jobId: job.id ?? null,
              jobName: job.name ?? null,
              payload: (job.data ?? {}) as object,
              errorMessage: error instanceof Error ? error.message : String(error),
              attemptsMade,
            },
          })
          .catch((dbError) => {
            log.error({ err: dbError, jobId: job.id, queue: job.queueName }, "falha ao persistir WorkerJobFailure para job terminalmente falho");
          });
      }
    });
  }

  log.info("processo de filas BullMQ iniciado");

  // GAP DE AUDITORIA FECHADO: sem handler de SIGTERM, um rolling deploy do
  // processo de workers mataria o processo com jobs BullMQ em andamento (ex.:
  // emissão fiscal síncrona de nota, backup criptografado em progresso) —
  // `Worker.close()` do BullMQ espera o job atualmente em processamento
  // terminar antes de encerrar a conexão com o Redis, evitando que o job
  // fique marcado como "stalled" e seja reprocessado do zero por outra réplica
  // enquanto ainda está rodando na réplica que está sendo desligada.
  const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;
  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "sinal de encerramento recebido, aguardando jobs em andamento finalizarem");

    const forceExitTimer = setTimeout(() => {
      log.error("graceful shutdown dos workers excedeu o timeout, forçando encerramento do processo");
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    try {
      await Promise.all(allWorkers.map((worker) => worker.close()));
      log.info("todos os workers BullMQ encerrados graciosamente");
    } catch (err) {
      log.error({ err }, "erro ao encerrar workers BullMQ durante graceful shutdown");
    }
    clearTimeout(forceExitTimer);
    process.exit(0);
  }

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
}

main().catch((error) => {
  createModuleLogger("worker").fatal({ err: error }, "falha fatal na inicialização");
  process.exit(1);
});
