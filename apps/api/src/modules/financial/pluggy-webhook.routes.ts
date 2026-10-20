// apps/api/src/modules/financial/pluggy-webhook.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.4.1 (Open Finance empresarial) e 22.5
// (Open Finance pessoal) — webhook real da Pluggy, contrato verificado em
// docs.pluggy.ai/docs/developer-tools/webhooks-ref (2026-10-14):
//
//   • Todo evento chega como POST JSON com, no mínimo, `event` (ex.: "item/updated",
//     "item/created", "item/error") e `eventId`; eventos de item trazem `itemId`.
//   • Eventos relevantes aqui: `item/created` e `item/updated` ("An item was updated
//     and synced successfully") — disparam a sincronização real de contas/transações;
//     `item/error`/`item/waiting_user_input` só atualizam o status do consentimento
//     para o usuário ver no painel, sem tentar sincronizar dado nenhum.
//   • VERIFICAÇÃO DE AUTENTICIDADE: a documentação oficial da Pluggy NÃO lista nenhum
//     header de assinatura (HMAC ou outro) para validar que uma requisição de webhook
//     realmente veio da Pluggy — ao contrário do Stripe (`Stripe-Signature`) e do
//     iFood (`X-IFood-Signature`) já implementados neste mesmo código. Inventar uma
//     verificação HMAC aqui seria simular uma proteção que não existe de verdade.
//     Proteção real aplicada: um segredo (`PLUGGY_WEBHOOK_TOKEN`, gerado por nós) é
//     embutido como query string `?token=...` na `webhookUrl` cadastrada no painel da
//     Pluggy (Connect Token/Item) — comparação timing-safe abaixo, igual ao padrão de
//     `ASAAS_WEBHOOK_TOKEN`. Além disso, a resposta é devolvida o mais rápido possível
//     (apenas enfileira o job real, nunca processa a sincronização inline), seguindo a
//     orientação da própria Pluggy de reconhecer o webhook rapidamente para evitar
//     reenvios/retries desnecessários.
import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { getPlatformSecret } from "../../lib/platform-secrets";
import { pluggySyncQueue } from "../../lib/queue";
import { createModuleLogger } from "../../lib/logger";
import { markWebhookEventProcessed, wasWebhookEventAlreadyProcessed } from "../../lib/webhook-replay-guard";

const log = createModuleLogger("pluggy-webhook");

export const pluggyWebhookRouter = Router();

const pluggyWebhookEventSchema = z.object({
  event: z.string().min(1),
  eventId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
});

// CORREÇÃO DE AUDITORIA (fa-w5-sec-pluggy-no-signature): a Pluggy não envia nenhum
// header de assinatura (ver nota no topo do arquivo), então o `?token=` estático é a
// única barreira de entrada — qualquer parte de posse do token (vazamento de log,
// painel, etc.) conseguiria reenviar manualmente uma requisição de webhook capturada
// indefinidamente. `eventId` (quando presente no payload real) identifica um disparo
// específico da Pluggy de forma única; quando ausente (payload fora do formato
// esperado/versão antiga), cai num bucket de 5 minutos por item+evento — ainda
// encurta reenvios em rajada do mesmo evento sem um identificador único, sem arriscar
// descartar dois eventos genuinamente distintos do mesmo item no mesmo evento.
const PLUGGY_REPLAY_GUARD_TTL_SECONDS = 60 * 60 * 24; // 24h
const PLUGGY_REPLAY_FALLBACK_BUCKET_MS = 5 * 60_000;

function pluggyReplayGuardKey(itemId: string, event: string, eventId: string | undefined): string {
  const bucket = eventId ?? `bucket:${Math.floor(Date.now() / PLUGGY_REPLAY_FALLBACK_BUCKET_MS)}`;
  return `pluggy-webhook:${itemId}:${event}:${bucket}`;
}

// Eventos que de fato disparam sincronização de conta/transação (Capítulo 17.4.1/22.5)
// — os demais (item/error, item/waiting_user_input, connector/status_updated, etc.)
// apenas são reconhecidos com 200 e logados, sem enfileirar nenhum job de sync.
const SYNC_TRIGGERING_EVENTS = new Set(["item/created", "item/updated"]);

function timingSafeTokenMatches(received: string, expected: string): boolean {
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  return receivedBuf.length === expectedBuf.length && crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

pluggyWebhookRouter.post("/webhooks/pluggy", async (req: Request, res: Response) => {
  const expectedToken = await getPlatformSecret("PLUGGY_WEBHOOK_TOKEN");
  const receivedToken = typeof req.query.token === "string" ? req.query.token : "";
  if (!expectedToken || !receivedToken || !timingSafeTokenMatches(receivedToken, expectedToken)) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_WEBHOOK_TOKEN", message: "Token de webhook da Pluggy ausente ou inválido." } });
  }

  const parsed = pluggyWebhookEventSchema.safeParse(req.body);
  if (!parsed.success) {
    // fa-w4-pluggy-webhook-raw-body-logged — logar `req.body` bruto aqui exporia
    // dado de Open Finance (bancário) de terceiros em texto puro no agregador de
    // logs sempre que a Pluggy mandar um payload fora do schema esperado. Melhor
    // prática documentada pela própria Pluggy continua sendo reconhecer rápido
    // (200) mesmo em payload inesperado, para nunca entrar em loop de retry — mas
    // só logamos campos não sensíveis (evento/itemId, quando presentes) e o
    // resumo estruturado do erro de validação do Zod, nunca o corpo inteiro.
    log.warn(
      { eventType: (req.body as Record<string, unknown> | undefined)?.event, itemId: (req.body as Record<string, unknown> | undefined)?.itemId, validationError: parsed.error.flatten() },
      "payload em formato inesperado",
    );
    return res.status(200).json({ success: true, data: { acknowledged: true }, error: null });
  }

  const { event, itemId, eventId } = parsed.data;

  if (!SYNC_TRIGGERING_EVENTS.has(event) || !itemId) {
    log.info({ event }, "evento recebido e reconhecido, sem ação de sincronização");
    return res.status(200).json({ success: true, data: { acknowledged: true }, error: null });
  }

  // CORREÇÃO DE AUDITORIA (fa-w5-sec-pluggy-no-signature): checagem de replay ANTES
  // de qualquer consulta/enfileiramento — um reenvio do mesmo evento (seja retry
  // legítimo da Pluggy, seja replay manual de uma requisição capturada) é apenas
  // reconhecido com 200, sem disparar uma nova sincronização nem bater no banco.
  const replayGuardKey = pluggyReplayGuardKey(itemId, event, eventId);
  if (await wasWebhookEventAlreadyProcessed(replayGuardKey)) {
    log.info({ event, itemId, eventId }, "evento de webhook Pluggy já processado recentemente — replay ignorado");
    return res.status(200).json({ success: true, data: { acknowledged: true, replay: true }, error: null });
  }

  const consent = await prisma.openFinanceConsent.findUnique({ where: { itemId } });
  if (!consent) {
    // itemId desconhecido (consentimento removido no Filitech, ou de outro cliente
    // Pluggy) — reconhece com 200 mesmo assim; não é um erro do lado da Pluggy.
    log.warn({ itemId }, "itemId não corresponde a nenhum OpenFinanceConsent conhecido");
    return res.status(200).json({ success: true, data: { acknowledged: true }, error: null });
  }

  await pluggySyncQueue.add(
    "sync-open-finance-item",
    { itemId, consentId: consent.id },
    { attempts: 5, backoff: { type: "exponential", delay: 10_000 } },
  );
  // Só marca como processado DEPOIS de enfileirar com sucesso — se o enfileiramento
  // falhar e a Pluggy reentregar, a reentrega deve disparar uma nova tentativa, não
  // ser descartada como replay de algo que nunca chegou a ser enfileirado.
  await markWebhookEventProcessed(replayGuardKey, PLUGGY_REPLAY_GUARD_TTL_SECONDS);

  return res.status(200).json({ success: true, data: { acknowledged: true, enqueued: true }, error: null });
});
