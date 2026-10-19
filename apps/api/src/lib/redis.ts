// apps/api/src/lib/redis.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.4 — Redis com namespace por tenant
// (tenant:{id}:cache) usado pelo gatekeeper (Cap.6.1) e pelas filas BullMQ.
import { Redis } from "ioredis";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("redis");

// fa-infra-redis-silent-localhost-fallback: o fallback para localhost só faz sentido
// em dev/test (onde infra/docker/docker-compose.dev.yml sobe um Redis local); em
// produção (Railway, containers do deploy/generic-host) a ausência de REDIS_URL é
// um erro de configuração que antes falhava silenciosamente tentando conectar em
// localhost:6379 dentro do próprio container — sem Redis ali, erro de conexão
// confuso e intermitente em vez de falha clara no boot.
if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL) {
  throw new Error(
    "REDIS_URL é obrigatório em produção (NODE_ENV=production) — defina a variável de " +
      "ambiente apontando para o Redis real (ver .env.example). Sem ela, o processo não " +
      "deve subir fingindo que vai usar um Redis local inexistente.",
  );
}

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on("error", (err) => {
  log.error({ err }, "erro de conexão");
});
