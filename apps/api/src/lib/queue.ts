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
} as const;

export const whatsappNotificationsQueue = new Queue(QUEUE_NAMES.WHATSAPP_NOTIFICATIONS, {
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
