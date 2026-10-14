// apps/api/src/modules/notifications/channels/email.channel.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 20.8 — canal de envio REAL de e-mail
// transacional (fallback de notificação), usando a API oficial da Resend
// (resend.com/docs/api-reference/emails/send-email): `POST https://api.resend.com/emails`,
// `Authorization: Bearer {apiKey}`, corpo JSON `{ from, to, subject, html }` — contrato
// confirmado via pesquisa web nesta sessão de auditoria antes de escrever este arquivo.
//
// GAP DE AUDITORIA FECHADO: EMAIL_RESEND já existia no enum `IntegrationProvider` e no
// framework central de credenciais, mas nenhum consumidor real definia o formato do
// payload cifrado. Esta função estabelece o contrato canônico daqui em diante:
// { apiKey: string, fromAddress: string } — mesmo padrão "credencial por tenant,
// nunca env var fixa" já usado por WhatsApp/Focus NFe/Asaas.
//
// Integração OPCIONAL por design: sem credencial ativa, retorna `{ success: false }`
// com mensagem honesta — nunca lança exceção (a notificação in-app sempre precisa
// continuar funcionando mesmo sem e-mail configurado).
import { prismaUnscoped as prisma } from "@filitech/db";
import { decryptEnvelope } from "../../../lib/envelope-crypto";

const REQUEST_TIMEOUT_MS = 10_000;

export interface SendEmailResult {
  success: boolean;
  message: string;
}

export async function sendTransactionalEmail(
  tenantId: string,
  toEmail: string,
  subject: string,
  htmlBody: string,
): Promise<SendEmailResult> {
  const credential = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider_environment: { tenantId, provider: "EMAIL_RESEND", environment: "PRODUCTION" } },
  });
  if (!credential || !credential.active) {
    return { success: false, message: "E-mail transacional não configurado para este tenant." };
  }

  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptEnvelope(Buffer.from(credential.encryptedPayload), credential.encryptionKeyId);
  } catch (error) {
    return { success: false, message: `Não foi possível decifrar a credencial de e-mail: ${(error as Error).message}` };
  }
  if (typeof decrypted.apiKey !== "string" || !decrypted.apiKey || typeof decrypted.fromAddress !== "string" || !decrypted.fromAddress) {
    return { success: false, message: "Payload da Resend inválido: esperado { apiKey, fromAddress }." };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decrypted.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: decrypted.fromAddress,
        to: [toEmail],
        subject,
        html: htmlBody,
      }),
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
