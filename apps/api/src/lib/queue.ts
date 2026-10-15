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

// BullMQ exige `maxRetriesPerRequest: null` na conexão dedicada que ele gerencia
// internamente (requisito documentado da própria lib) — connection isolada da
// usada pelo gatekeeper (lib/redis.ts) para não competir por retry/pipeline.
export const queueRedisConnection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

queueRedisConnection.on("error", (err) => {
  log.error({ err }, "erro de conexão");
});

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
} as const;

export const whatsappNotificationsQueue = new Queue(QUEUE_NAMES.WHATSAPP_NOTIFICATIONS, {
  connection: queueRedisConnection,
});

export const smsNotificationsQueue = new Queue(QUEUE_NAMES.SMS_NOTIFICATIONS, {
  connection: queueRedisConnection,
});

export const fiscalEmissionQueue = new Queue(QUEUE_NAMES.FISCAL_EMISSION, { connection: queueRedisConnection });

export const nfeXmlIngestionQueue = new Queue(QUEUE_NAMES.NFE_XML_INGESTION, { connection: queueRedisConnection });

export const reportGenerationQueue = new Queue(QUEUE_NAMES.REPORT_GENERATION, { connection: queueRedisConnection });

export const suspendOverdueTenantsQueue = new Queue(QUEUE_NAMES.SUSPEND_OVERDUE_TENANTS, {
  connection: queueRedisConnection,
});

export const pluggySyncQueue = new Queue(QUEUE_NAMES.PLUGGY_SYNC, { connection: queueRedisConnection });

export const loyaltyPointsExpirationQueue = new Queue(QUEUE_NAMES.LOYALTY_POINTS_EXPIRATION, {
  connection: queueRedisConnection,
});

export const scheduledSubscriptionCancellationsQueue = new Queue(QUEUE_NAMES.SCHEDULED_SUBSCRIPTION_CANCELLATIONS, {
  connection: queueRedisConnection,
});

export const webhookDeliveryQueue = new Queue(QUEUE_NAMES.WEBHOOK_DELIVERY, { connection: queueRedisConnection });

export const personalRecurrenceGenerationQueue = new Queue(QUEUE_NAMES.PERSONAL_RECURRENCE_GENERATION, {
  connection: queueRedisConnection,
});

export const personalBillRemindersQueue = new Queue(QUEUE_NAMES.PERSONAL_BILL_REMINDERS, {
  connection: queueRedisConnection,
});

export const dataExportGenerationQueue = new Queue(QUEUE_NAMES.DATA_EXPORT_GENERATION, {
  connection: queueRedisConnection,
});

export const dataImportValidationQueue = new Queue(QUEUE_NAMES.DATA_IMPORT_VALIDATION, {
  connection: queueRedisConnection,
});

export const dataImportExecutionQueue = new Queue(QUEUE_NAMES.DATA_IMPORT_EXECUTION, {
  connection: queueRedisConnection,
});

export const databaseBackupQueue = new Queue(QUEUE_NAMES.DATABASE_BACKUP, { connection: queueRedisConnection });

export const personalInvestmentQuotesQueue = new Queue(QUEUE_NAMES.PERSONAL_INVESTMENT_QUOTES, {
  connection: queueRedisConnection,
});

export const accountingRecurringTasksQueue = new Queue(QUEUE_NAMES.ACCOUNTING_RECURRING_TASKS, {
  connection: queueRedisConnection,
});
