// apps/api/src/lib/queue.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.4 — filas BullMQ sobre Redis:
// `whatsapp-notifications`, `fiscal-emission`, `nfe-xml-ingestion`,
// `report-generation`, `suspend-overdue-tenants`.
//
// Processo separado do processo HTTP principal (arquitetura Capítulo 3: "API Node.js xN |
// BullMQ Workers"), mas os PRODUTORES (enqueue) vivem na API e por isso a fábrica de
// conexão/filas fica neste módulo compartilhado — os Workers (consumidores) residem em
// src/workers/ e são iniciados por um processo `node` dedicado (`npm run worker`).
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("queue-redis");

// fa-infra-redis-silent-localhost-fallback: mesma justificativa de lib/redis.ts —
// em produção, nunca cair silenciosamente para um Redis local inexistente dentro
// do container (o worker/BullMQ ficaria tentando reconectar para sempre sem
// nenhum job sendo processado, sem nenhum log claro do motivo raiz).
if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL) {
  throw new Error(
    "REDIS_URL é obrigatório em produção (NODE_ENV=production) — defina a variável de " +
      "ambiente apontando para o Redis real (ver .env.example).",
  );
}

// BullMQ exige `maxRetriesPerRequest: null` na conexão dedicada que ele gerencia
// internamente (requisito documentado da própria lib) — connection isolada da
// usada pelo gatekeeper (lib/redis.ts) para não competir por retry/pipeline.
export const queueRedisConnection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

queueRedisConnection.on("error", (err) => {
  log.error({ err }, "erro de conexão");
});

// fa-w4-queue-unbounded-retention: até esta rodada NENHUM dos ~22 `new Queue(...)`
// abaixo passava `defaultJobOptions` — a maioria dos produtores também nunca definia
// `removeOnComplete`/`removeOnFail` no `add()`/`upsertJobScheduler()` individual, então
// o default do próprio BullMQ (manter TODO job concluído/falho para sempre) se
// aplicava, crescendo o uso de memória do Redis sem limite conforme o volume de jobs
// (ex.: `whatsapp-notifications`, `webhook-delivery` — alto volume, platform-wide)
// aumentava ao longo do tempo. Aplicado a TODA fila via este objeto compartilhado em
// vez de repetir a configuração em cada `new Queue(...)` (ou esquecer em alguma).
//
// `removeOnFail` é deliberadamente mais generoso que `removeOnComplete` (7 dias / 5000
// jobs vs. 24h / 1000 jobs): o listener único em `worker.ts` já persiste um
// `WorkerJobFailure` durável no Postgres no instante exato em que o job falha
// terminalmente (fa-w4-queue-no-dlq), então a retenção do próprio BullMQ aqui não é a
// ÚNICA rede de segurança para investigar falhas — mas mantê-la generosa ainda
// permite inspecionar o job falho (payload completo, stacktrace do BullMQ, histórico
// de tentativas) diretamente pelo Bull Board/Redis por até uma semana, sem depender
// só do que foi resumido no Postgres.
export const DEFAULT_QUEUE_JOB_OPTIONS = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
} as const;

// fa-w4-scheduler-no-retry-policy: `upsertJobScheduler(...)` sem `opts.attempts`
// explícito usa o default do BullMQ (1 tentativa, sem retry) — uma falha transitória
// isolada (timeout de rede, deadlock de lock otimista, etc.) numa execução de um cron
// recorrente (backup, varredura de NF-e, reconciliação, limpeza de billing) perdia
// SILENCIOSAMENTE aquela execução até o próximo disparo agendado, sem nenhuma
// segunda chance. Dois perfis: o "padrão" (jobs leves/médios, idempotentes) e o
// "pesado" (hoje só o backup criptografado do banco — Capítulo 10.3) com menos
// tentativas e backoff bem mais longo, pois cada tentativa já é cara (dump completo
// do banco) e um Redis/R2 momentaneamente instável não deveria disparar 3 dumps
// completos em sequência rápida.
export const DEFAULT_RECURRING_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
} as const;

export const HEAVY_RECURRING_JOB_OPTS = {
  attempts: 2,
  backoff: { type: "exponential" as const, delay: 60_000 },
} as const;

export const QUEUE_NAMES = {
  WHATSAPP_NOTIFICATIONS: "whatsapp-notifications",
  // Capítulo 20.2/20.8 — canal SMS real (Zenvia), espelhando exatamente o padrão da
  // fila acima: produzida por `notify.service.ts`, consumida por
  // `workers/sms-notifications.worker.ts`. GAP DE AUDITORIA FECHADO (Rodada 4).
  SMS_NOTIFICATIONS: "sms-notifications",
  FISCAL_EMISSION: "fiscal-emission",
  NFE_XML_INGESTION: "nfe-xml-ingestion",
  REPORT_GENERATION: "report-generation",
  SUSPEND_OVERDUE_TENANTS: "suspend-overdue-tenants",
  // Capítulo 17.4.1/22.5 — sincronização automática real via Pluggy (Open Finance):
  // consumida por `workers/pluggy-sync.worker.ts`, produzida pelo webhook `item/updated`
  // (`modules/financial/pluggy-webhook.routes.ts`) e pelas rotas de "sincronizar agora"
  // (business `bank-reconciliation.routes.ts` / pessoal `personal-planning.routes.ts`).
  PLUGGY_SYNC: "pluggy-sync",
  // Capítulo 4.1.1 — varredura diária de expiração de pontos de fidelidade
  // (`LoyaltyTransaction.expiresAt`), consumida por
  // `workers/expire-loyalty-points.worker.ts`.
  LOYALTY_POINTS_EXPIRATION: "loyalty-points-expiration",
  // Capítulo 2.7.6 — reconciliação diária de cancelamentos agendados
  // (`Subscription.cancelAtPeriodEnd=true` cujo `currentPeriodEnd` já passou),
  // consumida por `workers/enforce-scheduled-cancellations.worker.ts`. Necessária
  // porque o Asaas não suporta "cancelar no fim do ciclo" nativamente — o Stripe já
  // cancela sozinho via `cancel_at_period_end`, mas este job cobre os dois provedores
  // de forma uniforme e também fecha o `Tenant.status` local em ambos os casos.
  SCHEDULED_SUBSCRIPTION_CANCELLATIONS: "scheduled-subscription-cancellations",
  // Capítulo 15.4 — disparo real de webhooks de saída (TenantWebhookEndpoint),
  // consumida por `workers/webhook-delivery.worker.ts`. Produzida por
  // `lib/webhook-dispatch.ts` sempre que um serviço de domínio chama
  // `dispatchWebhookEvent()` após o commit do evento (ex.: venda fechada, NF-e
  // autorizada) — nunca síncrono dentro da transação que gerou o evento.
  WEBHOOK_DELIVERY: "webhook-delivery",
  // Capítulo 22.4 — motor de recorrência do Filitech Pessoal: gera automaticamente a
  // próxima PersonalTransaction de cada PersonalRecurrenceRule ativa cujo
  // `nextOccurrenceAt` já chegou, consumida por
  // `workers/personal-recurrence-generation.worker.ts`.
  PERSONAL_RECURRENCE_GENERATION: "personal-recurrence-generation",
  // Capítulo 22.8 — lembrete de contas a pagar do Filitech Pessoal
  // (PersonalBill.reminderDaysBefore) e marcação automática de OVERDUE após o
  // vencimento, consumida por `workers/personal-bill-reminders.worker.ts`.
  PERSONAL_BILL_REMINDERS: "personal-bill-reminders",
  // Capítulo 18.4 — geração do ZIP de exportação total de dados do tenant (CSVs +
  // XMLs fiscais/fotos de O.S. do R2 + schema-reference.json), consumida por
  // `workers/data-export-generation.worker.ts`. Job sob demanda (não repetível),
  // enfileirado por `POST /data-export`.
  DATA_EXPORT_GENERATION: "data-export-generation",
  // Capítulo 18.5 — validação sem gravação de um `DataImportJob` (regras de negócio
  // do cadastro manual rodadas linha a linha, sem tocar no banco), consumida por
  // `workers/data-import-validation.worker.ts`. Job sob demanda, enfileirado por
  // `POST /data-import/jobs/:id/validate`.
  DATA_IMPORT_VALIDATION: "data-import-validation",
  // Capítulo 18.5 — gravação transacional real dos registros validados, em lotes de
  // 500 por transação Prisma, com progresso ao vivo via SSE, consumida por
  // `workers/data-import-execution.worker.ts`. Job sob demanda, enfileirado por
  // `POST /data-import/jobs/:id/confirm`.
  DATA_IMPORT_EXECUTION: "data-import-execution",
  // Capítulo 10.3 — backup criptografado sem downtime do banco inteiro (dump lógico
  // via Prisma, já que o runtime de produção é uma imagem Docker distroless sem
  // `pg_dump`/shell — ver nota em `workers/encrypted-database-backup.worker.ts`),
  // consumida por esse worker. Cron diário 03:00 + disparo manual pelo painel admin.
  DATABASE_BACKUP: "database-backup",
  // Capítulo 22.6 — atualização diária automática de cotação de ações/FIIs (via
  // brapi.dev, ver nota de desvio de provedor em `lib/brapi-client.ts`) do Filitech
  // Pessoal, consumida por `workers/personal-investment-quotes.worker.ts`. Cron
  // diário após o fechamento do pregão da B3.
  PERSONAL_INVESTMENT_QUOTES: "personal-investment-quotes",
  // Capítulo 21.18.4 — geração mensal automática das AccountingTask padrão (DAS/DARF,
  // fechamento de folha, EFD-Reinf/DCTFWeb, e as anuais ECD/ECF/DEFIS/IRPF em março)
  // de cada AccountingEngagement ATIVO, consumida por
  // `workers/accounting-recurring-tasks.worker.ts`. GAP DE AUDITORIA FECHADO
  // (Rodada 4): antes só havia CRUD manual de AccountingTask, nenhuma geração
  // automática existia (Capítulo 21.18.4 ficava expressamente PENDENTE).
  ACCOUNTING_RECURRING_TASKS: "accounting-recurring-tasks",
  // Capítulo 21.19.4 — varredura diária de Distribuição DFe (NF-e de compra emitidas
  // contra o CNPJ do tenant), consumida por `workers/fetch-incoming-nfe.worker.ts`.
  // GAP DE AUDITORIA FECHADO: `FiscalDocumentType.NFE_ENTRADA` e
  // `FiscalDocumentEventType.RECIPIENT_MANIFESTATION` existiam no schema desde o
  // início mas nenhum código jamais os instanciava.
  FETCH_INCOMING_NFE: "fetch-incoming-nfe",
  // Capítulo 6.6/20.3 — varredura periódica (10 em 10 min) de `FiscalDocument` que
  // ficou PENDING sem nunca ter um job de emissão enfileirado com sucesso (ex.:
  // Redis fora do ar no instante exato do fechamento da venda), consumida por
  // `workers/reconcile-stuck-fiscal-documents.worker.ts`. GAP DE AUDITORIA FECHADO
  // (Rodada 7): antes, uma falha transitória nesse ponto podia deixar a nota fiscal
  // de uma venda já paga/baixada travada para sempre, sem nenhuma rede de segurança.
  RECONCILE_STUCK_FISCAL_DOCUMENTS: "reconcile-stuck-fiscal-documents",
  // Capítulo 9.3 — varredura diária de `Subscription.status = PENDING_CHECKOUT`
  // abandonado há mais de 24h, consumida por
  // `workers/expire-stale-pending-checkouts.worker.ts`. GAP DE AUDITORIA FECHADO
  // (Rodada 7): antes, um erro ambíguo (timeout) na criação do checkout no
  // provedor podia deixar a linha PENDING_CHECKOUT (e o cupom nela aplicado)
  // órfã para sempre, sem nenhuma rede de segurança.
  EXPIRE_STALE_PENDING_CHECKOUTS: "expire-stale-pending-checkouts",
  // fa-w4-stale-intermediate-status-reaper — varredura periódica (15 em 15 min) de
  // `DataImportJob`/`TenantDataExportJob`/`ReportExportJob` travados em status
  // intermediário (VALIDATING/IMPORTING/GENERATING) por tempo excessivo (processo do
  // worker morto no meio do trabalho), consumida por
  // `workers/reconcile-stuck-processing-jobs.worker.ts`. Mesmo princípio de
  // `RECONCILE_STUCK_FISCAL_DOCUMENTS`, generalizado para os demais jobs sob demanda
  // de longa duração que não tinham nenhuma rede de segurança equivalente.
  RECONCILE_STUCK_PROCESSING_JOBS: "reconcile-stuck-processing-jobs",
  // Capítulo 21.18.5/21.18.10/21.18.11 — geração sob demanda de documentos fiscais
  // oficiais (ECD/DEFIS/ECF/EFD-Reinf/DCTFWeb/Informe de Rendimentos do Sócio),
  // consumida por `workers/accounting-document-generation.worker.ts`. GAP DE
  // AUDITORIA FECHADO (fa-perf-accounting-doc-generation-inline): a geração
  // (incluindo upload R2) rodava síncrona dentro de `POST
  // /official-tax-documents/generate`, arriscando timeout/alto consumo de memória do
  // processo HTTP para documentos grandes. Job sob demanda (não repetível),
  // enfileirado pela mesma rota.
  ACCOUNTING_DOCUMENT_GENERATION: "accounting-document-generation",
  // Capítulo 18.3 — exportação sob demanda de um `ReportDefinition` para PDF/XLSX
  // (`GET /report-definitions/:id/export`), consumida por
  // `workers/report-export-generation.worker.ts`. GAP DE AUDITORIA FECHADO
  // (fa-perf-report-export-inline): a query/agregação completa + geração de
  // PDF/XLSX rodava síncrona dentro do processo HTTP, arriscando bloqueio do event
  // loop/alto consumo de memória sob carga. Job sob demanda, status/arquivo
  // persistidos em `ReportExportJob`.
  // Capítulo 18.3 — exportação sob demanda de um `ReportDefinition` para PDF/XLSX
  // (`GET /report-definitions/:id/export`), consumida por
  // `workers/report-export-generation.worker.ts`. GAP DE AUDITORIA FECHADO
  // (fa-perf-report-export-inline): a query/agregação completa + geração de
  // PDF/XLSX rodava síncrona dentro do processo HTTP, arriscando bloqueio do event
  // loop/alto consumo de memória sob carga. Job sob demanda, status/arquivo
  // persistidos em `ReportExportJob`.
  REPORT_EXPORT_GENERATION: "report-export-generation",
  // fa-w4-lgpd-no-deletion-workflow — Direito à Eliminação (LGPD Art. 18, VI):
  // processamento sob demanda (não repetível) de um `DataDeletionRequest` já
  // APROVADO, consumido por `workers/data-deletion-processing.worker.ts`.
  // Anonimiza (nunca apaga linhas) o PII diretamente identificável dos modelos
  // voltados ao cliente final do tenant — ver nota de design completa em
  // `schema.prisma`, model `DataDeletionRequest`. Enfileirado por
  // `POST /data-portability/deletion-requests/:id/approve`.
  DATA_DELETION_PROCESSING: "data-deletion-processing",
  // fa-w4-lgpd-no-retention-purge — varredura diária de `DataExport`
  // (`TenantDataExportJob`) COMPLETED há mais de 30 dias: apaga o ZIP do R2 e marca
  // `purgedAt`, consumida por `workers/data-retention-purge.worker.ts`. Ver nota de
  // escopo deliberadamente conservador no próprio worker.
  DATA_RETENTION_PURGE: "data-retention-purge",
  // fa-w6-bl-no-trial-expiry-enforcement — varredura diária de `Tenant.status =
  // TRIAL` cujo `trialEndsAt` já passou sem nenhuma assinatura paga confirmada:
  // transiciona para SUSPENDED (`suspensionReason = "TRIAL_EXPIRED"`), consumida
  // por `workers/trial-expiry-enforcement.worker.ts`.
  TRIAL_EXPIRY_ENFORCEMENT: "trial-expiry-enforcement",
  // fa-w6-bl-no-offboarding-retention — varredura diária de tenants SUSPENDED cujo
  // `purgeAt` já passou: anonimiza o PII diretamente identificável dos clientes do
  // tenant (nunca hard-delete), pulando/flagando para revisão manual tenants com
  // documentos fiscais sujeitos a guarda legal. Consumida por
  // `workers/tenant-offboarding-purge.worker.ts`.
  TENANT_OFFBOARDING_PURGE: "tenant-offboarding-purge",
  // fa-w6-bl-dunning-not-durable — fan-out do ENVIO de cada milestone da régua de
  // dunning (Capítulo 2.7.4), consumida por
  // `workers/dunning-milestone-dispatch.worker.ts`. A "decisão de notificar" já
  // foi persistida durável e atomicamente em `DunningMilestone` (mesma transação
  // da mudança de estado financeiro, dunning.service.ts); este job só entrega de
  // fato, com o retry/backoff automático do BullMQ — nunca mais um envio inline
  // com falha tratada só por log.
  DUNNING_MILESTONE_DISPATCH: "dunning-milestone-dispatch",
} as const;

// fa-w4-queue-unbounded-retention — fábrica única usada por TODA fila abaixo: garante
// que nenhuma fila nova esqueça `defaultJobOptions` (o bug original era justamente
// cada `new Queue(...)` repetir `{ connection: queueRedisConnection }` manualmente, e
// uma rodada futura adicionando mais uma fila sem copiar o `defaultJobOptions` junto).
function createQueue(name: string): Queue {
  return new Queue(name, { connection: queueRedisConnection, defaultJobOptions: DEFAULT_QUEUE_JOB_OPTIONS });
}

export const whatsappNotificationsQueue = createQueue(QUEUE_NAMES.WHATSAPP_NOTIFICATIONS);

export const smsNotificationsQueue = createQueue(QUEUE_NAMES.SMS_NOTIFICATIONS);

export const fiscalEmissionQueue = createQueue(QUEUE_NAMES.FISCAL_EMISSION);

export const nfeXmlIngestionQueue = createQueue(QUEUE_NAMES.NFE_XML_INGESTION);

export const reportGenerationQueue = createQueue(QUEUE_NAMES.REPORT_GENERATION);

export const suspendOverdueTenantsQueue = createQueue(QUEUE_NAMES.SUSPEND_OVERDUE_TENANTS);

export const pluggySyncQueue = createQueue(QUEUE_NAMES.PLUGGY_SYNC);

export const loyaltyPointsExpirationQueue = createQueue(QUEUE_NAMES.LOYALTY_POINTS_EXPIRATION);

export const scheduledSubscriptionCancellationsQueue = createQueue(QUEUE_NAMES.SCHEDULED_SUBSCRIPTION_CANCELLATIONS);

export const webhookDeliveryQueue = createQueue(QUEUE_NAMES.WEBHOOK_DELIVERY);

export const personalRecurrenceGenerationQueue = createQueue(QUEUE_NAMES.PERSONAL_RECURRENCE_GENERATION);

export const personalBillRemindersQueue = createQueue(QUEUE_NAMES.PERSONAL_BILL_REMINDERS);

export const dataExportGenerationQueue = createQueue(QUEUE_NAMES.DATA_EXPORT_GENERATION);

export const dataImportValidationQueue = createQueue(QUEUE_NAMES.DATA_IMPORT_VALIDATION);

export const dataImportExecutionQueue = createQueue(QUEUE_NAMES.DATA_IMPORT_EXECUTION);

export const databaseBackupQueue = createQueue(QUEUE_NAMES.DATABASE_BACKUP);

export const personalInvestmentQuotesQueue = createQueue(QUEUE_NAMES.PERSONAL_INVESTMENT_QUOTES);

export const accountingRecurringTasksQueue = createQueue(QUEUE_NAMES.ACCOUNTING_RECURRING_TASKS);

export const fetchIncomingNfeQueue = createQueue(QUEUE_NAMES.FETCH_INCOMING_NFE);

export const reconcileStuckFiscalDocumentsQueue = createQueue(QUEUE_NAMES.RECONCILE_STUCK_FISCAL_DOCUMENTS);

export const expireStalePendingCheckoutsQueue = createQueue(QUEUE_NAMES.EXPIRE_STALE_PENDING_CHECKOUTS);

export const reconcileStuckProcessingJobsQueue = createQueue(QUEUE_NAMES.RECONCILE_STUCK_PROCESSING_JOBS);

export const accountingDocumentGenerationQueue = createQueue(QUEUE_NAMES.ACCOUNTING_DOCUMENT_GENERATION);

export const reportExportGenerationQueue = createQueue(QUEUE_NAMES.REPORT_EXPORT_GENERATION);

export const dataDeletionProcessingQueue = createQueue(QUEUE_NAMES.DATA_DELETION_PROCESSING);

export const dataRetentionPurgeQueue = createQueue(QUEUE_NAMES.DATA_RETENTION_PURGE);

export const trialExpiryEnforcementQueue = createQueue(QUEUE_NAMES.TRIAL_EXPIRY_ENFORCEMENT);

export const tenantOffboardingPurgeQueue = createQueue(QUEUE_NAMES.TENANT_OFFBOARDING_PURGE);

export const dunningMilestoneDispatchQueue = createQueue(QUEUE_NAMES.DUNNING_MILESTONE_DISPATCH);
