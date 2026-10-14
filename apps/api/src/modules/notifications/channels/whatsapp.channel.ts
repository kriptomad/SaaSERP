// apps/api/src/modules/notifications/channels/whatsapp.channel.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 20.2 — canal de envio REAL de WhatsApp
// (fecha o gap em que `notifyTenant()` só gravava a notificação no banco e nunca
// de fato enviava nada). Mesmo provedor/credencial já usado pelo teste de conexão
// em `test-integration-credential.ts` (`testWhatsAppMetaCloud`): WhatsApp Cloud API
// oficial da Meta (developers.facebook.com/docs/whatsapp/cloud-api/reference/messages),
// uma credencial `IntegrationCredential` POR TENANT (provider WHATSAPP_META_CLOUD,
// environment PRODUCTION), payload cifrado { accessToken, phoneNumberId }.
//
// Integração OPCIONAL por design (mesmo princípio de vehicle-plate-lookup.service.ts):
// sem credencial ativa cadastrada, retorna `{ success: false }` com mensagem honesta —
// NUNCA lança exceção aqui, pois o canal in-app (Notification no banco) precisa
// continuar funcionando mesmo quando o lojista não contratou/configurou WhatsApp.
import { prismaUnscoped as prisma } from "@filitech/db";
import { decryptEnvelope } from "../../../lib/envelope-crypto";
import { withCircuitBreaker } from "../../../lib/circuit-breaker";

const REQUEST_TIMEOUT_MS = 10_000;
const WHATSAPP_BREAKER = "whatsapp-cloud";

export interface SendWhatsAppResult {
  success: boolean;
  message: string;
}

export async function sendWhatsAppText(tenantId: string, toE164Phone: string, body: string): Promise<SendWhatsAppResult> {
  const credential = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider_environment: { tenantId, provider: "WHATSAPP_META_CLOUD", environment: "PRODUCTION" } },
  });
  if (!credential || !credential.active) {
    return { success: false, message: "WhatsApp não configurado para este tenant." };
  }

  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptEnvelope(Buffer.from(credential.encryptedPayload), credential.encryptionKeyId);
  } catch (error) {
    return { success: false, message: `Não foi possível decifrar a credencial do WhatsApp: ${(error as Error).message}` };
  }
  if (typeof decrypted.accessToken !== "string" || typeof decrypted.phoneNumberId !== "string") {
    return { success: false, message: "Payload do WhatsApp Cloud inválido: esperado { accessToken, phoneNumberId }." };
  }
  // Vinculados a `const` locais (em vez de acessar `decrypted.*` dentro do closure
  // abaixo) para preservar o estreitamento de tipo (`string`) feito acima: o
  // TypeScript não propaga o estreitamento de propriedades de objeto através de
  // fronteiras de função/closure.
  const accessToken = decrypted.accessToken;
  const phoneNumberId = decrypted.phoneNumberId;

  try {
    const response = await withCircuitBreaker(WHATSAPP_BREAKER, () =>
      fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: "POST",
        headers: {
        Authorization: `Bearer ${decrypted.accessToken}`,
        "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toE164Phone.replace(/^\+/, ""), // Graph API espera o número sem o "+" (ex.: "5511999998888")
          type: "text",
          text: { body },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );
    const bodyText = await response.text();
    if (response.ok) {
      return { success: true, message: "Mensagem enviada com sucesso via WhatsApp Cloud API." };
    }
    return { success: false, message: `Falha ao enviar WhatsApp (HTTP ${response.status}): ${bodyText.slice(0, 500)}` };
  } catch (error) {
    return { success: false, message: `Falha de rede ao enviar WhatsApp: ${(error as Error).message}` };
  }
}
