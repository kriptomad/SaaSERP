// apps/api/src/workers/webhook-delivery.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 15.4 — consumidor real da fila
// `webhook-delivery` (produzida por lib/webhook-dispatch.ts). Fecha o gap de
// auditoria em que `WebhookDelivery` tinha leitura (GET .../deliveries) mas nunca
// nenhuma escrita: a tabela ficava sempre vazia porque nada jamais entregava nada.
//
// Cada tentativa HTTP grava sua PRÓPRIA linha em WebhookDelivery (nunca
// atualiza uma linha anterior) — o histórico completo de tentativas (inclusive as
// que falharam antes do BullMQ tentar de novo) fica visível na tela de depuração do
// tenant, com `attemptCount` = número da tentativa do BullMQ (`job.attemptsMade + 1`).
//
// Assinatura HMAC-SHA256 do payload com o `signingSecret` do próprio endpoint
// (cabeçalho `X-Filitech-Signature`, mesmo padrão adotado por Stripe/GitHub
// webhooks) — permite ao tenant validar que a requisição realmente veio da
// Filitech e não foi forjada por terceiros.
import { Worker, Job } from "bullmq";
import { createHmac } from "node:crypto";
import { prismaUnscoped as prisma } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { decryptEnvelope } from "../lib/envelope-crypto";
import { createModuleLogger } from "../lib/logger";
import { ssrfSafeFetch } from "../lib/ssrf-safe-fetch";
import type { WebhookDeliveryJobData } from "../lib/webhook-dispatch";

const log = createModuleLogger("webhook-delivery");
const REQUEST_TIMEOUT_MS = 10_000;

function decryptSigningSecret(signingSecretEncrypted: string): string {
  const [encryptionKeyId, base64Payload] = signingSecretEncrypted.split(":", 2);
  const decrypted = decryptEnvelope(Buffer.from(base64Payload, "base64"), encryptionKeyId);
  if (typeof decrypted.signingSecret !== "string") {
    throw new Error("Payload de signingSecretEncrypted inválido: esperado { signingSecret }.");
  }
  return decrypted.signingSecret;
}

export async function webhookDeliveryProcessor(job: Job<WebhookDeliveryJobData>): Promise<{ success: boolean }> {
  const { endpointId, eventType, payload } = job.data;

  const endpoint = await prisma.tenantWebhookEndpoint.findUnique({ where: { id: endpointId } });
  // Endpoint pode ter sido desativado/excluído entre o enfileiramento e o
  // processamento — não é um erro de entrega, apenas não há mais para onde entregar.
  if (!endpoint || !endpoint.active) {
    return { success: false };
  }

  const bodyJson = JSON.stringify({ eventType, data: payload, sentAt: new Date().toISOString() });
  const signingSecret = decryptSigningSecret(endpoint.signingSecretEncrypted);
  const signature = createHmac("sha256", signingSecret).update(bodyJson).digest("hex");

  let statusCode: number | null = null;
  let success = false;
  try {
    // GAP DE AUDITORIA FECHADO (mega-audit rodada 10): `fetch()` global não
    // resolvia/validava o IP de destino nem recusava redirecionamentos — um host
    // público cadastrado que passasse a resolver (DNS rebinding) ou redirecionasse
    // para um IP privado/metadata da nuvem seria entregue sem bloqueio. `ssrfSafeFetch`
    // resolve e valida o IP no exato momento da conexão TCP e nunca segue 3xx.
    const response = await ssrfSafeFetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Filitech-Signature": signature,
        "X-Filitech-Event": eventType,
      },
      body: bodyJson,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    statusCode = response.statusCode;
    success = response.statusCode >= 200 && response.statusCode < 300;
  } catch (error) {
    log.warn({ endpointId, eventType, err: error }, "falha de rede ao entregar webhook");
  }

  await prisma.webhookDelivery.create({
    data: {
      endpointId: endpoint.id,
      eventType,
      statusCode: statusCode ?? undefined,
      success,
      attemptCount: job.attemptsMade + 1,
      payload: payload as any,
    },
  });

  if (!success) {
    // Lança para que o BullMQ aplique o backoff exponencial configurado em
    // dispatchWebhookEvent (até 6 tentativas) — nunca engole a falha silenciosamente.
    throw new Error(`Entrega de webhook falhou (endpoint=${endpointId}, status=${statusCode ?? "sem resposta"}).`);
  }
  return { success: true };
}

export function startWebhookDeliveryWorker(): Worker {
  return new Worker<WebhookDeliveryJobData>(QUEUE_NAMES.WEBHOOK_DELIVERY, webhookDeliveryProcessor, {
    connection: queueRedisConnection,
    concurrency: 10,
  });
}
