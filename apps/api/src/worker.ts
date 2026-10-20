// apps/api/src/worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3 — topologia "API Node.js xN | BullMQ Workers":
// processo Node.js dedicado, separado da API HTTP, que consome as filas BullMQ.
// Iniciado via `npm run worker` (ver package.json), nunca dentro do processo do Express.
import "dotenv/config";
// fa-w5-boot-no-central-env-validation: mesma justificativa de server.ts — precisa
// ser o PRIMEIRO import depois de `dotenv/config`.
import "./lib/env-validation";
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
import { QUEUE_NAMES } from "./lib/queue";
import { redis } from "./lib/redis";
import type { Job } from "bullmq";

// fa-w5-boot-replica-race-schedulers: toda réplica do worker chamava TODOS os
// `schedule*Job()`/`sync*Schedulers()` no boot sem nenhuma coordenação — o único
// motivo disso nunca ter corrompido nada é que `Queue.upsertJobScheduler()` do
// BullMQ é, por design, idempotente (upsert por `schedulerId`, não um `add()`
// simples): múltiplas réplicas chamando a mesma função ao mesmo tempo resultam no
// mesmo schedule final no Redis, não em schedulers duplicados. Essa era uma
// suposição IMPLÍCITA — este lock a torna uma garantia EXPLÍCITA e documentada:
// só a réplica que ganha o `SET NX PX` abaixo de fato chama os `schedule*Job()`;
// as demais apenas logam e seguem direto para consumir jobs das filas (que já são
// um construto compartilhado no Redis, visível a qualquer réplica assim que a
// vencedora os registra). TTL curto (60s): só precisa vencer a janela de cold
// start simultâneo, nunca precisa ficar retido além do boot.
const SCHEDULER_REGISTRATION_LOCK_KEY = "filitech:worker:scheduler-registration-lock";
const SCHEDULER_REGISTRATION_LOCK_TTL_MS = 60_000;

async function tryAcquireSchedulerRegistrationLock(): Promise<boolean> {
  // `SET key value NX PX ttl` — atômico no Redis; só a primeira réplica a chegar
  // aqui recebe "OK", as demais recebem `null` sem nenhum efeito colateral.
  const result = await redis.set(
    SCHEDULER_REGISTRATION_LOCK_KEY,
    `${process.pid}:${Date.now()}`,
    "PX",
    SCHEDULER_REGISTRATION_LOCK_TTL_MS,
    "NX",
  );
  return result === "OK";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fa-w5-worker-boot-dependency-crash-loop: as chamadas de `schedule*Job()`/
// `sync*Schedulers()` dependem de Redis (BullMQ) e Postgres (algumas leem config
// do tenant) já estarem prontos — num cold start de infraestrutura (containers do
// `docker-compose`/Railway subindo ao mesmo tempo), é comum o processo do worker
// iniciar ANTES do Redis/Postgres aceitarem conexões, rejeitando a primeira
// tentativa. Antes desta correção, uma falha aqui derrubava `main()` direto para
// `process.exit(1)`, consumindo o orçamento LIMITADO de restart do Railway
// (`restartPolicyMaxRetries = 5`) só para erros de ORDEM DE BOOT que se resolveriam
// sozinhos em poucos segundos. Retry com backoff exponencial (5 tentativas, 2s →
// 4s → 8s → 16s → 30s, nunca além de 30s) absorve essa janela de corrida dentro do
// MESMO processo, sem gastar nenhum restart externo — só se esgotarem todas as
// tentativas (problema real, não transitório) o processo de fato sai com
// `process.exit(1)` e deixa o restart policy da plataforma assumir.
const SCHEDULER_SETUP_MAX_ATTEMPTS = 5;
const SCHEDULER_SETUP_BASE_DELAY_MS = 2_000;
const SCHEDULER_SETUP_MAX_DELAY_MS = 30_000;

async function registerAllJobSchedulers(): Promise<void> {
  // Lista central dos `schedule*Job()`/`sync*Schedulers()` — todos independentes
  // entre si (filas diferentes), por isso disparados em paralelo; qualquer um que
  // rejeite propaga para o retry com backoff do chamador.
  await Promise.all([
    scheduleSuspendOverdueTenantsJob(),
    scheduleExpireLoyaltyPointsJob(),
    scheduleEnforceScheduledCancellationsJob(),
    schedulePersonalRecurrenceGenerationJob(),
    schedulePersonalBillRemindersJob(),
    scheduleEncryptedDatabaseBackupJob(),
    syncScheduledReportJobSchedulers(),
    schedulePersonalInvestmentQuotesJob(),
    scheduleAccountingRecurringTasksJob(),
    scheduleFetchIncomingNfeJob(),
    scheduleReconcileStuckFiscalDocumentsJob(),
    scheduleExpireStalePendingCheckoutsJob(),
    scheduleDataRetentionPurgeJob(),
    scheduleReconcileStuckProcessingJobsJob(),
  ]);
}

async function setupJobSchedulersWithLockAndRetry(log: ReturnType<typeof createModuleLogger>): Promise<void> {
  for (let attempt = 1; attempt <= SCHEDULER_SETUP_MAX_ATTEMPTS; attempt += 1) {
    try {
      const lockAcquired = await tryAcquireSchedulerRegistrationLock();
      if (!lockAcquired) {
        log.info(
          { lockKey: SCHEDULER_REGISTRATION_LOCK_KEY },
          "outra réplica já detém o lock de registro de schedulers para este boot — pulando registro " +
            "(schedulers BullMQ são um construto compartilhado no Redis, visível a esta réplica assim " +
            "que a vencedora os registrar); seguindo direto para consumir jobs.",
        );
        return;
      }
      await registerAllJobSchedulers();
      log.info("schedulers de jobs recorrentes (BullMQ) registrados com sucesso.");
      return;
    } catch (err) {
      if (attempt === SCHEDULER_SETUP_MAX_ATTEMPTS) {
        log.fatal(
          { err, attempt, maxAttempts: SCHEDULER_SETUP_MAX_ATTEMPTS },
          "falha DEFINITIVA ao registrar schedulers de jobs recorrentes após todas as tentativas — " +
            "abortando boot do worker.",
        );
        throw err;
      }
      const delayMs = Math.min(SCHEDULER_SETUP_BASE_DELAY_MS * 2 ** (attempt - 1), SCHEDULER_SETUP_MAX_DELAY_MS);
      log.error(
        { err, attempt, maxAttempts: SCHEDULER_SETUP_MAX_ATTEMPTS, nextAttemptDelayMs: delayMs },
        `falha ao registrar schedulers de jobs recorrentes (tentativa ${attempt}/${SCHEDULER_SETUP_MAX_ATTEMPTS}) — ` +
          `provavelmente Redis/Postgres ainda não estão prontos neste cold start; tentando novamente em ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }
}

// fa-w5-notif-delivery-failure-silent-to-users — único ponto que escreve
// `Notification.deliveryStatus/deliveryError` a partir do resultado de um job
// BullMQ de fan-out externo (WhatsApp/SMS). Chamado pelos listeners
// `completed`/`failed` do array `allWorkers` abaixo para QUALQUER fila — só age de
// fato quando o job pertence a `WHATSAPP_NOTIFICATIONS`/`SMS_NOTIFICATIONS` E seu
// payload tem `notificationId` (produzido por `notify.service.ts`,
// `enqueueWhatsAppJob`/`enqueueSmsJob`); demais filas/jobs são ignorados (`return`
// silencioso), nunca um erro.
const NOTIFICATION_DELIVERY_QUEUES: Set<string> = new Set([QUEUE_NAMES.WHATSAPP_NOTIFICATIONS, QUEUE_NAMES.SMS_NOTIFICATIONS]);
// Mensagem de erro truncada mais agressivamente que o limite de 500 chars já
// aplicado pelos próprios channels (whatsapp.channel.ts/sms.channel.ts) — este
// campo é exibido na UI (não um log técnico), então fica bem mais curto.
const MAX_DELIVERY_ERROR_LENGTH = 300;

function sanitizeDeliveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Nunca permite que um token/segredo de provedor vazado por engano numa mensagem
  // de erro (ex.: um 401 da Resend/Zenvia ecoando o header enviado) chegue à UI.
  const redacted = raw.replace(/bearer\s+\S+/gi, "[redacted]").replace(/x-api-token\s*[:=]\s*\S+/gi, "[redacted]");
  return redacted.length > MAX_DELIVERY_ERROR_LENGTH ? `${redacted.slice(0, MAX_DELIVERY_ERROR_LENGTH - 1)}…` : redacted;
}

async function persistNotificationDeliveryOutcome(
  job: Job | undefined,
  status: "SENT" | "FAILED",
  error: unknown,
): Promise<void> {
  if (!job || !NOTIFICATION_DELIVERY_QUEUES.has(job.queueName)) return;
  const notificationId = (job.data as { notificationId?: string } | undefined)?.notificationId;
  if (!notificationId) return;

  try {
    await prismaUnscoped.notification.update({
      where: { id: notificationId },
      data: {
        deliveryStatus: status,
        deliveryError: status === "FAILED" ? sanitizeDeliveryError(error) : null,
      },
    });
  } catch (dbError) {
    // Notification pode já ter sido apagada (ex.: tenant removido/cascade) — nunca
    // deixa isso derrubar o processamento normal do job/listener.
    createModuleLogger("worker").error(
      { err: dbError, notificationId, queue: job.queueName },
      "falha ao persistir deliveryStatus da Notification após resultado do envio externo",
    );
  }
}

async function main() {
  // fa-w4-obs-no-error-tracking-apm / fa-w4-obs-no-crash-handlers-worker: mesmo
  // mecanismo de server.ts (process-guards.ts compartilhado) — este processo não
  // tem Express, mas um bug não tratado num job BullMQ pode igualmente lançar uma
  // exceção síncrona ou deixar uma Promise sem `.catch`, derrubando/zumbificando o
  // processo de workers inteiro sem nenhuma pista.
  initSentry("filitech-worker");
  installProcessCrashGuards("filitech-worker");

  const log = createModuleLogger("worker");

  // fa-w5-boot-replica-race-schedulers / fa-w5-worker-boot-dependency-crash-loop:
  // os consumidores (`start*Worker()`) são criados incondicionalmente em TODA
  // réplica (é assim que a distribuição de carga entre réplicas funciona — cada
  // uma compete pelos mesmos jobs na fila compartilhada do Redis). Só o registro
  // dos SCHEDULERS (produtores de jobs recorrentes) logo abaixo é que precisa de
  // coordenação entre réplicas — ver `setupJobSchedulersWithLockAndRetry`.
  const suspendOverdueTenantsWorker = startSuspendOverdueTenantsWorker();
  const fiscalEmissionWorker = startFiscalEmissionWorker();
  const whatsappNotificationsWorker = startWhatsAppNotificationsWorker();
  const smsNotificationsWorker = startSmsNotificationsWorker();
  const pluggySyncWorker = startPluggySyncWorker();
  const expireLoyaltyPointsWorker = startExpireLoyaltyPointsWorker();
  const enforceScheduledCancellationsWorker = startEnforceScheduledCancellationsWorker();
  const webhookDeliveryWorker = startWebhookDeliveryWorker();
  const personalRecurrenceGenerationWorker = startPersonalRecurrenceGenerationWorker();
  const personalBillRemindersWorker = startPersonalBillRemindersWorker();
  // Capítulo 18.4/18.5 — jobs sob demanda (não repetíveis), por isso sem
  // `schedule*Job()` equivalente ao dos workers acima.
  const dataExportGenerationWorker = startDataExportGenerationWorker();
  const dataImportValidationWorker = startDataImportValidationWorker();
  const dataImportExecutionWorker = startDataImportExecutionWorker();
  const encryptedDatabaseBackupWorker = startEncryptedDatabaseBackupWorker();
  const scheduledReportGenerationWorker = startScheduledReportGenerationWorker();
  const personalInvestmentQuotesWorker = startPersonalInvestmentQuotesWorker();
  const accountingRecurringTasksWorker = startAccountingRecurringTasksWorker();
  const fetchIncomingNfeWorker = startFetchIncomingNfeWorker();
  const reconcileStuckFiscalDocumentsWorker = startReconcileStuckFiscalDocumentsWorker();
  const expireStalePendingCheckoutsWorker = startExpireStalePendingCheckoutsWorker();
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
  // fa-w4-stale-intermediate-status-reaper — varredura periódica de
  // DataImportJob/TenantDataExportJob/ReportExportJob travados em status
  // intermediário, mesmo princípio de `reconcileStuckFiscalDocumentsWorker` acima.
  const reconcileStuckProcessingJobsWorker = startReconcileStuckProcessingJobsWorker();

  // Fase de registro de schedulers: protegida por lock distribuído no Redis
  // (fa-w5-boot-replica-race-schedulers) e por retry com backoff exponencial
  // (fa-w5-worker-boot-dependency-crash-loop). Roda DEPOIS de criar os
  // consumidores acima — mesmo que o registro demore algumas tentativas, os
  // workers já estão de pé e prontos para processar qualquer job que já exista na
  // fila (inclusive os que outra réplica acabou de agendar).
  await setupJobSchedulersWithLockAndRetry(log);

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

      // fa-w5-notif-delivery-failure-silent-to-users — sucesso do envio externo
      // (WhatsApp/SMS) atualiza de volta a Notification in-app de origem, para o
      // sininho conseguir mostrar "entregue" em vez de ficar PENDING para sempre.
      void persistNotificationDeliveryOutcome(job, "SENT", null);
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

        // fa-w5-notif-delivery-failure-silent-to-users — falha TERMINAL (mesmo
        // critério `isTerminalFailure` do DLQ abaixo) do fan-out WhatsApp/SMS
        // também grava um sinal visível ao usuário final na própria Notification
        // in-app, complementar ao WorkerJobFailure (registro técnico/operacional).
        void persistNotificationDeliveryOutcome(job, "FAILED", error);

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
