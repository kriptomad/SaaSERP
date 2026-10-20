// apps/api/src/workers/scheduled-report-generation.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.2 — disparo real do cron de
// `ScheduledReport`. GAP DE AUDITORIA FECHADO (mega-audit rodada 3):
// `reportGenerationQueue` já existia em lib/queue.ts e já aparecia no
// dashboard de saúde (system-status.service.ts), mas nenhum produtor jamais
// enfileirava nada e nenhum worker jamais a consumia — o agendamento era
// persistido em `ScheduledReport.cronExpression` e nunca executado de fato.
//
// Agendamento via BullMQ Job Scheduler (`queue.upsertJobScheduler`), uma por
// `ScheduledReport.id` (reports.routes.ts faz upsert/remove no CRUD) — não um
// cron próprio/node-cron paralelo, para reaproveitar o mesmo Redis/BullMQ já
// usado por todo o resto do sistema (retry, backoff, observabilidade única).
import { Worker, Job } from "bullmq";
import { prismaUnscoped, TenantScopedPrismaClient } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, reportGenerationQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";
import { executeReportDefinition, InvalidReportFieldError, ReportFilterCondition } from "../modules/reports/execute-report-definition";
import { buildReportPdf, buildReportXlsx } from "../modules/reports/report-export.service";
import { sendTransactionalEmail } from "../modules/notifications/channels/email.channel";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("scheduled-report-generation");

export interface ScheduledReportJobData {
  scheduledReportId: string;
}

export async function scheduledReportGenerationProcessor(job: Job<ScheduledReportJobData>): Promise<{ sent: number }> {
  const { scheduledReportId } = job.data;

  const schedule = await prismaUnscoped.scheduledReport.findUnique({
    where: { id: scheduledReportId },
    include: { reportDefinition: true },
  });
  // O agendamento pode ter sido desativado/excluído entre o enfileiramento
  // (repeat) e o processamento — não é um erro, o job scheduler correspondente
  // já deveria ter sido removido por reports.routes.ts, mas o job que já estava
  // na fila no instante da remoção ainda pode rodar uma última vez.
  if (!schedule || !schedule.active) {
    return { sent: 0 };
  }
  if (!schedule.reportDefinition) {
    log.warn({ scheduledReportId }, "ScheduledReport sem ReportDefinition associada — pulando execução.");
    return { sent: 0 };
  }

  // `executeReportDefinition` só usa `$queryRawUnsafe` com `tenantId` sempre
  // vinculado como parâmetro — o mesmo contrato de `TenantScopedPrismaClient` e
  // `PrismaClient` puro nesse método, então o cast é seguro aqui (worker roda
  // fora de qualquer req.session, não há AsyncLocalStorage de tenant para usar
  // o client auto-escopado).
  const tenantScopedPrisma = prismaUnscoped as unknown as TenantScopedPrismaClient;
  const definition = schedule.reportDefinition;

  let rows: Record<string, unknown>[];
  try {
    rows = await executeReportDefinition(tenantScopedPrisma, schedule.tenantId, {
      datasetKey: definition.datasetKey,
      dimensions: definition.dimensions as string[],
      metrics: definition.metrics as string[],
      filters: definition.filters as unknown as ReportFilterCondition[],
    });
  } catch (error) {
    if (error instanceof InvalidReportFieldError) {
      log.error({ scheduledReportId, err: error }, "ReportDefinition inválida ao executar relatório agendado — agendamento precisa ser corrigido pelo tenant.");
      return { sent: 0 };
    }
    throw error;
  }

  const safeFileName = definition.name.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60) || "relatorio";
  const buffer = schedule.format === "XLSX" ? await buildReportXlsx(definition.name, rows) : await buildReportPdf(definition.name, rows);
  const extension = schedule.format === "XLSX" ? "xlsx" : "pdf";
  const attachment = { filename: `${safeFileName}.${extension}`, contentBase64: buffer.toString("base64") };

  const subject = `Relatório agendado: ${definition.name}`;
  const html = `<p>Segue em anexo o relatório <strong>${definition.name}</strong>, gerado automaticamente pelo Filitech ERP (${rows.length} linha(s)).</p>`;

  let sentCount = 0;
  for (const recipientEmail of schedule.recipientEmails) {
    const result = await sendTransactionalEmail(schedule.tenantId, recipientEmail, subject, html, [attachment]);
    if (result.success) {
      sentCount += 1;
    } else {
      log.warn({ scheduledReportId, recipientEmail, message: result.message }, "falha ao enviar relatório agendado por e-mail");
    }
  }

  await prismaUnscoped.scheduledReport.update({ where: { id: scheduledReportId }, data: { lastRunAt: new Date() } });

  return { sent: sentCount };
}

export function startScheduledReportGenerationWorker(): Worker {
  return new Worker<ScheduledReportJobData>(QUEUE_NAMES.REPORT_GENERATION, scheduledReportGenerationProcessor, {
    connection: queueRedisConnection,
    concurrency: 5,
  });
}

// Resincroniza os Job Schedulers do BullMQ com o estado atual de `ScheduledReport`
// na inicialização do processo de workers — cobre o caso de o Redis ter sido
// recriado (ex.: troca de instância) enquanto a tabela já tinha agendamentos
// ativos criados por reports.routes.ts. Idempotente: `upsertJobScheduler` nunca
// duplica um scheduler já existente com o mesmo `jobSchedulerId`.
export async function syncScheduledReportJobSchedulers(): Promise<void> {
  const activeSchedules = await prismaUnscoped.scheduledReport.findMany({ where: { active: true }, select: { id: true, cronExpression: true } });
  for (const schedule of activeSchedules) {
    await reportGenerationQueue.upsertJobScheduler(
      schedule.id,
      { pattern: schedule.cronExpression },
      { name: "run-scheduled-report", data: { scheduledReportId: schedule.id } satisfies ScheduledReportJobData, opts: DEFAULT_RECURRING_JOB_OPTS },
    );
  }
}
