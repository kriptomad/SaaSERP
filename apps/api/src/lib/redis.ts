// apps/api/src/lib/redis.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.4 — Redis com namespace por tenant
// (tenant:{id}:cache) usado pelo gatekeeper (Cap.6.1) e pelas filas BullMQ.
import { Redis } from "ioredis";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("redis");

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on("error", (err) => {
  log.error({ err }, "erro de conexão");
});
