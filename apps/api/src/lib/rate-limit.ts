// apps/api/src/lib/rate-limit.ts
// Fonte: BIBLE_ENGINEERING_V2.md — padrão citado em diversos capítulos (ex.: Capítulo
// 6.8/14.3): "Redis INCR com TTL" para lockout por tentativas (PIN de gerente, login).
// Implementação real única, reaproveitada por qualquer fluxo que precise de rate
// limiting por tentativas — nunca uma contagem em memória do processo, que se perderia
// em restart e não funcionaria com múltiplas réplicas da API atrás do load balancer.
import { redis } from "./redis";

export class RateLimitExceededError extends Error {}

export async function enforceRateLimit(key: string, maxAttempts: number, windowSeconds: number): Promise<void> {
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (attempts > maxAttempts) {
    throw new RateLimitExceededError(
      `Muitas tentativas. Tente novamente em alguns minutos (limite de ${maxAttempts} a cada ${windowSeconds}s).`,
    );
  }
}

export async function resetRateLimit(key: string): Promise<void> {
  await redis.del(key);
}
