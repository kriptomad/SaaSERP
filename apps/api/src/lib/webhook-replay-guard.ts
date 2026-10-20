// apps/api/src/lib/webhook-replay-guard.ts
// CORREÇÃO DE AUDITORIA (fa-w5-sec-pluggy-no-signature / fa-w5-sec-asaas-unsigned-body /
// fa-w5-sec-ifood-replay): camada de defesa em profundidade contra reentrega/replay de
// webhooks de provedores externos (Pluggy, Asaas, iFood) que não oferecem (Pluggy) ou
// cujo header estático (Asaas `asaas-access-token`) não é suficiente, por si só, para
// impedir que uma requisição capturada/vazada seja reenviada manualmente por um
// atacante de posse do segredo. Usa Redis (já usado pelo rate-limit, ver
// `apps/api/src/lib/rate-limit.ts`) como registro de curto/médio prazo dos
// identificadores de evento já processados, com TTL — nunca substitui a idempotência
// de negócio real já existente (ex.: `BillingEvent`/@@unique, `idempotencyKey` de
// Sale/Payment), apenas adiciona um atalho rápido ANTES de qualquer processamento caro
// (consultas/transações de banco) para encurtar reentregas repetidas do mesmo evento.
//
// IMPORTANTE: um identificador só deve ser marcado como "processado" DEPOIS que o
// processamento correspondente foi de fato concluído com sucesso — nunca no
// recebimento. Caso contrário, uma reentrega legítima de um evento que falhou na
// primeira tentativa (erro transitório de banco, etc.) seria descartada
// silenciosamente como "replay" antes de ter sido processada de verdade, perdendo o
// evento para sempre (o provedor nunca mais reentrega algo que já recebeu 200).
import { redis } from "./redis";

const DEFAULT_REPLAY_GUARD_TTL_SECONDS = 60 * 60 * 24; // 24h — janela generosa acima de qualquer retry window real dos provedores (Pluggy/Asaas/iFood reentregam, no máximo, por algumas horas)

/** Verifica se este identificador de evento de webhook já foi processado com sucesso recentemente. */
export async function wasWebhookEventAlreadyProcessed(eventKey: string): Promise<boolean> {
  return (await redis.get(eventKey)) !== null;
}

/** Marca este identificador de evento de webhook como processado com sucesso, pelo TTL informado. */
export async function markWebhookEventProcessed(
  eventKey: string,
  ttlSeconds: number = DEFAULT_REPLAY_GUARD_TTL_SECONDS,
): Promise<void> {
  await redis.set(eventKey, "1", "EX", ttlSeconds);
}
