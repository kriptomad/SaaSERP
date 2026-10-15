// apps/api/src/worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3 — topologia "API Node.js xN | BullMQ Workers":
// processo Node.js dedicado, separado da API HTTP, que consome as filas BullMQ.
// Iniciado via `npm run worker` (ver package.json), nunca dentro do processo do Express.
import "dotenv/config";
import { createModuleLogger } from "./lib/logger";
import { startSuspendOverdueTenantsWorker, scheduleSuspendOverdueTenantsJob } from "./workers/suspend-overdue-tenants.worker";
import { startFiscalEmissionWorker } from "./workers/fiscal-emission.worker";
import { startWhatsAppNotificationsWorker } from "./workers/whatsapp-notifications.worker";
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

async function main() {
  const log = createModuleLogger("worker");
  const suspendOverdueTenantsWorker = startSuspendOverdueTenantsWorker();
  await scheduleSuspendOverdueTenantsJob();
  const fiscalEmissionWorker = startFiscalEmissionWorker();
  const whatsappNotificationsWorker = startWhatsAppNotificationsWorker();
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

  for (const worker of [suspendOverdueTenantsWorker, fiscalEmissionWorker, whatsappNotificationsWorker, pluggySyncWorker, expireLoyaltyPointsWorker, enforceScheduledCancellationsWorker, webhookDeliveryWorker, personalRecurrenceGenerationWorker, personalBillRemindersWorker, dataExportGenerationWorker, dataImportValidationWorker, dataImportExecutionWorker, encryptedDatabaseBackupWorker, scheduledReportGenerationWorker]) {
    worker.on("completed", (job) => {
      log.info({ queue: job.queueName, jobId: job.id, result: job.returnvalue }, "job concluído");
    });

    worker.on("failed", (job, error) => {
      log.error({ queue: job?.queueName, jobId: job?.id, err: error }, "job falhou");
    });
  }

  log.info("processo de filas BullMQ iniciado");
}

main().catch((error) => {
  createModuleLogger("worker").fatal({ err: error }, "falha fatal na inicialização");
  process.exit(1);
});
