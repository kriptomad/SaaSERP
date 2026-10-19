// apps/api/src/lib/rate-limit.ts
// Fonte: BIBLE_ENGINEERING_V2.md — padrão citado em diversos capítulos (ex.: Capítulo
// 6.8/14.3): "Redis INCR com TTL" para lockout por tentativas (PIN de gerente, login).
// Implementação real única, reaproveitada por qualquer fluxo que precise de rate
// limiting por tentativas — nunca uma contagem em memória do processo, que se perderia
// em restart e não funcionaria com múltiplas réplicas da API atrás do load balancer.
import { redis } from "./redis";

export class RateLimitExceededError extends Error {}

// GAP DE AUDITORIA FECHADO: `INCR` seguido de `EXPIRE` em duas chamadas separadas não
// é atômico — se o processo morrer (crash, OOM-kill, deploy) entre as duas, a chave
// fica com o contador > 0 mas SEM TTL, virando um bloqueio permanente (a vítima nunca
// mais consegue tentar de novo, mesmo passado o `windowSeconds`, até alguém apagar a
// chave manualmente no Redis). O script Lua abaixo roda as duas operações num único
// comando `EVAL`, atômico por natureza no Redis (single-threaded, sem outro comando
// podendo intercalar no meio da execução do script) — o `EXPIRE` só é aplicado quando
// o valor retornado pelo `INCR` for 1 (primeira ocorrência dentro da janela), exatamente
// o mesmo critério já usado antes, só que agora sem a janela entre as duas chamadas.
const INCR_WITH_TTL_SCRIPT = `
local attempts = redis.call("INCR", KEYS[1])
if attempts == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return attempts
`;

export async function enforceRateLimit(key: string, maxAttempts: number, windowSeconds: number): Promise<void> {
  const attempts = Number(await redis.eval(INCR_WITH_TTL_SCRIPT, 1, key, windowSeconds));
  if (attempts > maxAttempts) {
    throw new RateLimitExceededError(
      `Muitas tentativas. Tente novamente em alguns minutos (limite de ${maxAttempts} a cada ${windowSeconds}s).`,
    );
  }
}

export async function resetRateLimit(key: string): Promise<void> {
  await redis.del(key);
}
