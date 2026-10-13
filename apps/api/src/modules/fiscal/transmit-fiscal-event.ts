// apps/api/src/modules/fiscal/transmit-fiscal-event.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.19.2/20.3 — transmissão real do evento
// fiscal (cancelamento) via Focus NFe. Segue o mesmo padrão de "fail-closed
// configurável" já usado para o Stripe client (Capítulo 2): se o tenant ainda não
// configurou a credencial FISCAL_FOCUS_NFE no painel, a chamada falha explicitamente
// (nunca retorna um sucesso simulado) — o lojista precisa ativar e testar a
// integração no painel admin antes de qualquer cancelamento real ser possível.
//
// Contrato real confirmado via documentação oficial Focus NFe (doc.focusnfe.com.br):
//   - NFC-e: DELETE https://api.focusnfe.com.br/v2/nfce/{referencia}
//   - NF-e modelo 55: DELETE https://api.focusnfe.com.br/v2/nfe/{referencia}
//   - {referencia} aceita tanto a referência interna quanto a CHAVE DE ACESSO da nota
//     — como ainda não há um fluxo de emissão real que gere uma referência própria
//     nesta fase (o incremento de emissão/importNfeXml está documentado como
//     adiamento à parte), usa-se `fiscalDocument.accessKey` como referência, que a
//     própria Focus NFe aceita nesse campo.
//   - Body JSON: { "justificativa": string } (15-255 caracteres, já validado antes
//     deste ponto por cancelFiscalDocument).
//   - Autenticação: HTTP Basic Auth, usuário = token Focus NFe, senha vazia (padrão
//     documentado da Focus NFe: "Authorization: Basic base64(token + ':')").
//   - Respostas: 200 (cancelado), 400/401/403/404/415/422 (erro) — nunca um sucesso
//     simulado fora desses casos.
import { PrismaClient } from "@filitech/db";
import { decryptEnvelope } from "../../lib/envelope-crypto";

export class FocusNfeNotConfiguredError extends Error {}
export class FiscalDocumentMissingAccessKeyError extends Error {}

export interface FiscalEventTransmissionResult {
  authorized: boolean;
  protocolNumber: string | null;
  rejectionReason: string | null;
}

interface FocusNfeCredentialPayload {
  token: string;
  [key: string]: unknown;
}

function isFocusNfeCredentialPayload(value: Record<string, unknown>): value is FocusNfeCredentialPayload {
  return typeof value.token === "string" && value.token.length > 0;
}

/**
 * Localiza a credencial Focus NFe aplicável: prioriza uma credencial própria do
 * tenant (lojista trouxe seu próprio contrato Focus NFe) e cai para a credencial de
 * plataforma (tenantId nulo — conta mestra/revenda Filitech) quando o tenant não
 * configurou a própria, conforme o modelo documentado no schema
 * (IntegrationCredential.tenantId nulo = "credencial de plataforma").
 */
async function resolveFocusNfeCredential(prisma: PrismaClient, tenantId: string) {
  const tenantCredential = await prisma.integrationCredential.findUnique({
    where: {
      tenantId_provider_environment: { tenantId, provider: "FISCAL_FOCUS_NFE", environment: "PRODUCTION" },
    },
  });
  if (tenantCredential?.active) {
    return tenantCredential;
  }

  const platformCredential = await prisma.integrationCredential.findFirst({
    where: { tenantId: null, provider: "FISCAL_FOCUS_NFE", environment: "PRODUCTION", active: true },
  });
  return platformCredential ?? null;
}

export async function transmitFiscalEvent(
  prisma: PrismaClient,
  params: { tenantId: string; fiscalDocumentEventId: string },
): Promise<FiscalEventTransmissionResult> {
  const event = await prisma.fiscalDocumentEvent.findUniqueOrThrow({
    where: { id: params.fiscalDocumentEventId },
    include: { fiscalDocument: true },
  });

  if (!event.fiscalDocument.accessKey) {
    // A Focus NFe aceita a chave de acesso como {referencia} no path do cancelamento —
    // sem ela, não há como identificar a nota junto ao provedor. Isto só pode ocorrer
    // para documentos que nunca chegaram a ser efetivamente autorizados pela SEFAZ,
    // caso em que o cancelamento nem deveria ter sido tentado (guarda redundante).
    throw new FiscalDocumentMissingAccessKeyError(
      "Documento fiscal sem chave de acesso registrada — impossível identificar a nota junto à Focus NFe para cancelamento.",
    );
  }

  const credential = await resolveFocusNfeCredential(prisma, params.tenantId);
  if (!credential) {
    throw new FocusNfeNotConfiguredError(
      "A integração com a Focus NFe ainda não foi configurada/ativada para este tenant nem existe credencial de plataforma. Configure-a em Configurações > Integrações antes de cancelar documentos fiscais.",
    );
  }

  const decrypted = decryptEnvelope(Buffer.from(credential.encryptedPayload), credential.encryptionKeyId);
  if (!isFocusNfeCredentialPayload(decrypted)) {
    throw new FocusNfeNotConfiguredError(
      "Credencial Focus NFe cadastrada está com formato inválido (esperado { token }). Refaça o cadastro em Configurações > Integrações.",
    );
  }

  if (!event.justification) {
    // Guarda redundante: cancelFiscalDocument já exige >=15 caracteres antes de criar
    // o evento, então isto só ocorreria se outro fluxo criasse um evento sem passar
    // por essa validação — nunca deve chegar aqui em uso normal.
    throw new FiscalDocumentMissingAccessKeyError("Evento de cancelamento sem justificativa registrada — não pode ser transmitido à Focus NFe.");
  }

  const endpointPath = event.fiscalDocument.type === "NFCE" ? "nfce" : "nfe";
  const referencia = encodeURIComponent(event.fiscalDocument.accessKey);
  const basicAuth = Buffer.from(`${decrypted.token}:`).toString("base64");

  const response = await fetch(`https://api.focusnfe.com.br/v2/${endpointPath}/${referencia}`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ justificativa: event.justification }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.status === 200) {
    return {
      authorized: true,
      protocolNumber: typeof body.protocolo_cancelamento === "string" ? body.protocolo_cancelamento : null,
      rejectionReason: null,
    };
  }

  // 400/401/403/404/415/422 — a Focus NFe retorna `mensagem`/`erros` no corpo JSON de erro.
  const rejectionReason =
    typeof body.mensagem === "string"
      ? body.mensagem
      : Array.isArray(body.erros)
        ? JSON.stringify(body.erros)
        : `Falha HTTP ${response.status} sem corpo de erro interpretável.`;

  return { authorized: false, protocolNumber: null, rejectionReason };
}
