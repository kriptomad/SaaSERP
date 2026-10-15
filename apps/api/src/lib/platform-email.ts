// apps/api/src/lib/platform-email.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 14.3 — fecha o gap de auditoria em que o
// link de reset de senha de admin da plataforma era apenas logado (`logger.warn`),
// nunca enviado de verdade. Usa a credencial de PLATAFORMA (PLATFORM_RESEND_API_KEY /
// PLATFORM_RESEND_FROM_ADDRESS, ver platform-secrets.ts) — não a credencial por tenant
// `EMAIL_RESEND` de notifications/channels/email.channel.ts, que exige um `tenantId` e
// não se aplica a admins da plataforma (que não pertencem a nenhum tenant).
import { getPlatformSecret } from "./platform-secrets";

const REQUEST_TIMEOUT_MS = 10_000;

export interface SendPlatformEmailResult {
  success: boolean;
  message: string;
}

/**
 * Envia um e-mail transacional em nome da PLATAFORMA (não de um tenant). Retorna
 * `{ success: false }` com mensagem honesta se a credencial não estiver configurada —
 * nunca lança exceção, para que o chamador possa cair de volta no fallback de log.
 */
export async function sendPlatformEmail(
  toEmail: string,
  subject: string,
  htmlBody: string,
): Promise<SendPlatformEmailResult> {
  const [apiKey, fromAddress] = await Promise.all([
    getPlatformSecret("PLATFORM_RESEND_API_KEY"),
    getPlatformSecret("PLATFORM_RESEND_FROM_ADDRESS"),
  ]);

  if (!apiKey || !fromAddress) {
    return { success: false, message: "E-mail transacional de plataforma não configurado (PLATFORM_RESEND_API_KEY/PLATFORM_RESEND_FROM_ADDRESS)." };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress, to: [toEmail], subject, html: htmlBody }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const bodyText = await response.text();
    if (response.ok) {
      return { success: true, message: "E-mail enviado com sucesso via Resend." };
    }
    return { success: false, message: `Falha ao enviar e-mail (HTTP ${response.status}): ${bodyText.slice(0, 500)}` };
  } catch (error) {
    return { success: false, message: `Falha de rede ao enviar e-mail: ${(error as Error).message}` };
  }
}
