// apps/api/src/modules/notifications/channels/sms.channel.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 20.2/20.8 — canal de envio REAL de SMS.
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 4): `IntegrationProvider.SMS_ZENVIA`
// existia no schema e no catálogo de integrações desde rodadas anteriores, mas
// nenhum client/service jamais enviava um SMS de verdade — só havia o teste de
// decodificação da credencial (`test-integration-credential.ts`). Mesmo padrão de
// `whatsapp.channel.ts`: credencial `IntegrationCredential` POR TENANT (provider
// SMS_ZENVIA, environment PRODUCTION), payload cifrado { apiToken, from }.
//
// Contrato HTTP confirmado via pesquisa na documentação oficial da Zenvia API v2
// (zenvia.com/docs): POST https://api.zenvia.com/v2/channels/sms/messages,
// header X-API-TOKEN, body { from, to, contents: [{ type: "text", text }] }.
//
// Integração OPCIONAL por design (mesmo princípio de whatsapp.channel.ts): sem
// credencial ativa cadastrada, retorna `{ success: false }` com mensagem honesta —
// NUNCA lança exceção aqui, pois o canal in-app precisa continuar funcionando
// mesmo quando o lojista não contratou/configurou SMS.
import { prismaUnscoped as prisma } from "@filitech/db";
import { decryptEnvelope } from "../../../lib/envelope-crypto";
import { withCircuitBreaker } from "../../../lib/circuit-breaker";

const REQUEST_TIMEOUT_MS = 10_000;
const SMS_BREAKER = "sms-zenvia";
// Limite documentado da Zenvia para SMS via content type "text": acima disso o
// provedor fragmenta em múltiplas mensagens cobradas separadamente — truncar aqui
// evita cobrança surpresa ao lojista por um corpo de notificação gigante.
const MAX_SMS_LENGTH = 300;

export interface SendSmsResult {
  success: boolean;
  message: string;
}

export async function sendSmsText(tenantId: string, toE164Phone: string, body: string): Promise<SendSmsResult> {
  const credential = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider_environment: { tenantId, provider: "SMS_ZENVIA", environment: "PRODUCTION" } },
  });
  if (!credential || !credential.active) {
    return { success: false, message: "SMS não configurado para este tenant." };
  }

  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptEnvelope(Buffer.from(credential.encryptedPayload), credential.encryptionKeyId);
  } catch (error) {
    return { success: false, message: `Não foi possível decifrar a credencial do SMS: ${(error as Error).message}` };
  }
  if (typeof decrypted.apiToken !== "string" || typeof decrypted.from !== "string") {
    return { success: false, message: "Payload da Zenvia inválido: esperado { apiToken, from }." };
  }
  const apiToken = decrypted.apiToken;
  const from = decrypted.from;
  const text = body.length > MAX_SMS_LENGTH ? `${body.slice(0, MAX_SMS_LENGTH - 1)}…` : body;

  try {
    const response = await withCircuitBreaker(SMS_BREAKER, () =>
      fetch("https://api.zenvia.com/v2/channels/sms/messages", {
        method: "POST",
        headers: {
          "X-API-TOKEN": apiToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: toE164Phone.replace(/^\+/, ""), // Zenvia espera o número sem o "+" (ex.: "5511999998888")
          contents: [{ type: "text", text }],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );
    const bodyText = await response.text();
    if (response.ok) {
      return { success: true, message: "Mensagem enviada com sucesso via Zenvia SMS." };
    }
    return { success: false, message: `Falha ao enviar SMS (HTTP ${response.status}): ${bodyText.slice(0, 500)}` };
  } catch (error) {
    return { success: false, message: `Falha de rede ao enviar SMS: ${(error as Error).message}` };
  }
}
