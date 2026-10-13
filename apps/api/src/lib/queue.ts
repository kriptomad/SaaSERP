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

// BullMQ exige `maxRetriesPerRequest: null` na conexão dedicada que ele gerencia
// internamente (requisito documentado da própria lib) — connection isolada da
// usada pelo gatekeeper (lib/redis.ts) para não competir por retry/pipeline.
export const queueRedisConnection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

queueRedisConnection.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[queue-redis] erro de conexão:", err.message);
});

export const QUEUE_NAMES = {
  WHATSAPP_NOTIFICATIONS: "whatsapp-notifications",
  FISCAL_EMISSION: "fiscal-emission",
  NFE_XML_INGESTION: "nfe-xml-ingestion",
  REPORT_GENERATION: "report-generation",
  SUSPEND_OVERDUE_TENANTS: "suspend-overdue-tenants",
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
