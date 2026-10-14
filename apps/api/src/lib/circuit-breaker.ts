// apps/api/src/lib/circuit-breaker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8 (Confiabilidade/SRE) — circuit breaker
// para integrações externas instáveis (SEFAZ/Focus NFe, WhatsApp Cloud API). Gap da
// mega-auditoria: essas chamadas eram feitas diretamente via `fetch`, sem nenhuma
// proteção — uma instabilidade prolongada do provedor (comum em SEFAZ, notoriamente
// instável em horários de pico) fazia toda requisição esperar o timeout cheio antes
// de falhar, direto no caminho de fechamento de venda/envio de notificação.
//
// Implementação clássica de 3 estados (CLOSED → OPEN → HALF_OPEN → CLOSED), em
// memória do processo (nunca Redis — o objetivo é proteger ESTE processo de insistir
// em chamadas a um provedor fora do ar, não coordenar estado entre processos; cada
// processo decide por si, o que é aceitável e até desejável para isolamento de falha).
//
// CLOSED: opera normalmente; cada falha incrementa um contador.
// OPEN: contador atingiu `failureThreshold` — todas as chamadas falham IMEDIATAMENTE
//   (sem nem tentar a rede) até `resetTimeoutMs` se passar, evitando sobrecarregar um
//   provedor já instável e devolvendo erro rápido ao caller (fail-fast).
// HALF_OPEN: após o timeout, a PRÓXIMA chamada é uma sondagem; sucesso fecha o
//   circuito (volta a CLOSED), falha reabre (volta a OPEN e reinicia o timeout).
export class CircuitOpenError extends Error {
  constructor(breakerName: string, retryAfterMs: number) {
    super(`Circuito "${breakerName}" aberto — integração externa instável, tente novamente em ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = "CircuitOpenError";
  }
}

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface BreakerEntry {
  state: CircuitState;
  failureCount: number;
  openedAt: number | null;
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // falhas consecutivas até abrir o circuito
  resetTimeoutMs: number; // tempo em OPEN antes de permitir uma sondagem (HALF_OPEN)
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = { failureThreshold: 5, resetTimeoutMs: 30_000 };

const breakers = new Map<string, BreakerEntry>();

function getOrCreateBreaker(name: string): BreakerEntry {
  let entry = breakers.get(name);
  if (!entry) {
    entry = { state: "CLOSED", failureCount: 0, openedAt: null };
    breakers.set(name, entry);
  }
  return entry;
}

// Executa `fn` protegida pelo circuito `name`. Lança `CircuitOpenError` sem nem
// chamar `fn` quando o circuito está OPEN e o timeout de reset ainda não passou.
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  options: Partial<CircuitBreakerOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const entry = getOrCreateBreaker(name);

  if (entry.state === "OPEN") {
    const elapsed = Date.now() - (entry.openedAt ?? 0);
    if (elapsed < opts.resetTimeoutMs) {
      throw new CircuitOpenError(name, opts.resetTimeoutMs - elapsed);
    }
    // Timeout de reset expirado — permite exatamente UMA sondagem (HALF_OPEN).
    entry.state = "HALF_OPEN";
  }

  try {
    const result = await fn();
    // Sucesso em CLOSED ou HALF_OPEN sempre fecha/mantém fechado o circuito.
    entry.state = "CLOSED";
    entry.failureCount = 0;
    entry.openedAt = null;
    return result;
  } catch (error) {
    entry.failureCount += 1;
    if (entry.state === "HALF_OPEN" || entry.failureCount >= opts.failureThreshold) {
      entry.state = "OPEN";
      entry.openedAt = Date.now();
    }
    throw error;
  }
}

// Exposto para o health-check/painel admin inspecionar o estado atual sem precisar
// disparar uma chamada real (Capítulo 12 — "Página de status pública").
export function getCircuitBreakerStatus(name: string): { state: CircuitState; failureCount: number } {
  const entry = breakers.get(name);
  return entry ? { state: entry.state, failureCount: entry.failureCount } : { state: "CLOSED", failureCount: 0 };
}
