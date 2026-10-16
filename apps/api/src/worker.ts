// apps/api/src/worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3 — topologia "API Node.js xN | BullMQ Workers":
// processo Node.js dedicado, separado da API HTTP, que consome as filas BullMQ.
// Iniciado via `npm run worker` (ver package.json), nunca dentro do processo do Express.
import "dotenv/config";
import { createModuleLogger } from "./lib/logger";
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

async function main() {
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

  for (const worker of [suspendOverdueTenantsWorker, fiscalEmissionWorker, whatsappNotificationsWorker, smsNotificationsWorker, pluggySyncWorker, expireLoyaltyPointsWorker, enforceScheduledCancellationsWorker, webhookDeliveryWorker, personalRecurrenceGenerationWorker, personalBillRemindersWorker, dataExportGenerationWorker, dataImportValidationWorker, dataImportExecutionWorker, encryptedDatabaseBackupWorker, scheduledReportGenerationWorker, personalInvestmentQuotesWorker, accountingRecurringTasksWorker, fetchIncomingNfeWorker]) {
    worker.on("completed", (job) => {
      log.info({ queue: job.queueName, jobId: job.id, result: job.returnvalue }, "job concluído");
    });

    worker.on("failed", (job, error) => {
      log.error({ queue: job?.queueName, jobId: job?.id, err: error }, "job falhou");
    });
  }

  log.info("processo de filas BullMQ iniciado");

  const allWorkers = [suspendOverdueTenantsWorker, fiscalEmissionWorker, whatsappNotificationsWorker, smsNotificationsWorker, pluggySyncWorker, expireLoyaltyPointsWorker, enforceScheduledCancellationsWorker, webhookDeliveryWorker, personalRecurrenceGenerationWorker, personalBillRemindersWorker, dataExportGenerationWorker, dataImportValidationWorker, dataImportExecutionWorker, encryptedDatabaseBackupWorker, scheduledReportGenerationWorker, personalInvestmentQuotesWorker, accountingRecurringTasksWorker, fetchIncomingNfeWorker, reconcileStuckFiscalDocumentsWorker, expireStalePendingCheckoutsWorker];

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
