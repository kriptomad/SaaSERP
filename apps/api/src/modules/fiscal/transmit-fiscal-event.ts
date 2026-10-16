// apps/api/src/modules/fiscal/transmit-fiscal-event.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.19.2/21.19.3/21.19.4/20.3 — transmissão
// real dos três eventos fiscais pós-emissão (cancelamento, CC-e, manifestação do
// destinatário) via Focus NFe. Segue o mesmo padrão de "fail-closed configurável" já
// usado para o Stripe client (Capítulo 2): se o tenant ainda não configurou a
// credencial FISCAL_FOCUS_NFE no painel, a chamada falha explicitamente (nunca
// retorna um sucesso simulado) — o lojista precisa ativar e testar a integração no
// painel admin antes de qualquer evento real ser possível.
//
// Contrato real confirmado via documentação oficial Focus NFe (doc.focusnfe.com.br):
//   - Cancelamento NFC-e: DELETE https://api.focusnfe.com.br/v2/nfce/{referencia}
//   - Cancelamento NF-e modelo 55: DELETE https://api.focusnfe.com.br/v2/nfe/{referencia}
//     Body: { "justificativa": string } (15-255 caracteres).
//   - CC-e (NF-e modelo 55 apenas): POST https://api.focusnfe.com.br/v2/nfe/{referencia}/carta_correcao
//     Body: { "correcao": string } (15-1000 caracteres). Retorno inclui
//     `numero_carta_correcao`/`caminho_xml_carta_correcao`/`caminho_pdf_carta_correcao`.
//   - Manifestação do Destinatário: POST https://api.focusnfe.com.br/v2/nfes_recebidas/{chave}/manifesto
//     Body: { "tipo": "ciencia"|"confirmacao"|"desconhecimento"|"nao_realizada",
//     "justificativa"?: string (obrigatória e 15-255 caracteres só quando tipo = nao_realizada) }.
//   - {referencia}/{chave} aceitam tanto a referência interna quanto a CHAVE DE ACESSO
//     da nota — como ainda não há um fluxo de emissão real que gere uma referência
//     própria nesta fase (o incremento de emissão/importNfeXml está documentado como
//     adiamento à parte), usa-se `fiscalDocument.accessKey` como referência, que a
//     própria Focus NFe aceita nesse campo.
//   - Autenticação: HTTP Basic Auth, usuário = token Focus NFe, senha vazia (padrão
//     documentado da Focus NFe: "Authorization: Basic base64(token + ':')").
//   - Respostas de sucesso: 200/201 — qualquer outro status é tratado como rejeição,
//     nunca um sucesso simulado.
import { TenantScopedPrismaClient } from "@filitech/db";
import { decryptFocusNfeCredential, resolveFocusNfeCredential, FocusNfeNotConfiguredError } from "./focus-nfe-credential";
import { withCircuitBreaker } from "../../lib/circuit-breaker";

const FOCUS_NFE_BREAKER = "focus-nfe";

export { FocusNfeNotConfiguredError };
export class FiscalDocumentMissingAccessKeyError extends Error {}

export interface FiscalEventTransmissionResult {
  authorized: boolean;
  protocolNumber: string | null;
  rejectionReason: string | null;
}

// Mapa tipo de manifestação (schema real, português) -> valor aceito pela API da
// Focus NFe (`tipo`, inglês/português abreviado) — nunca o inverso, para que o
// schema do Prisma permaneça legível em português como todo o resto do domínio.
const MANIFESTATION_TYPE_TO_FOCUS_NFE: Record<string, string> = {
  CIENCIA_DA_OPERACAO: "ciencia",
  CONFIRMACAO_DA_OPERACAO: "confirmacao",
  DESCONHECIMENTO_DA_OPERACAO: "desconhecimento",
  OPERACAO_NAO_REALIZADA: "nao_realizada",
};

async function transmitCancellationOrCorrectionLetter(
  decrypted: { token: string },
  event: { eventType: string; justification: string | null; fiscalDocument: { type: string; accessKey: string | null } },
): Promise<FiscalEventTransmissionResult> {
  const referencia = encodeURIComponent(event.fiscalDocument.accessKey!);
  const basicAuth = Buffer.from(`${decrypted.token}:`).toString("base64");
  const endpointPath = event.fiscalDocument.type === "NFCE" ? "nfce" : "nfe";

  const response = await withCircuitBreaker(FOCUS_NFE_BREAKER, () =>
    event.eventType === "CANCELLATION"
      ? fetch(`https://api.focusnfe.com.br/v2/${endpointPath}/${referencia}`, {
          method: "DELETE",
          headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ justificativa: event.justification }),
        })
      : fetch(`https://api.focusnfe.com.br/v2/nfe/${referencia}/carta_correcao`, {
          method: "POST",
          headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ correcao: event.justification }),
        }),
  );

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.status === 200 || response.status === 201) {
    return {
      authorized: true,
      protocolNumber:
        typeof body.protocolo_cancelamento === "string"
          ? body.protocolo_cancelamento
          : typeof body.numero_carta_correcao === "string"
            ? body.numero_carta_correcao
            : null,
      rejectionReason: null,
    };
  }

  const rejectionReason =
    typeof body.mensagem === "string"
      ? body.mensagem
      : Array.isArray(body.erros)
        ? JSON.stringify(body.erros)
        : `Falha HTTP ${response.status} sem corpo de erro interpretável.`;

  return { authorized: false, protocolNumber: null, rejectionReason };
}

async function transmitRecipientManifestation(
  decrypted: { token: string },
  event: { manifestationType: string | null; justification: string | null; fiscalDocument: { accessKey: string | null } },
): Promise<FiscalEventTransmissionResult> {
  const tipo = event.manifestationType ? MANIFESTATION_TYPE_TO_FOCUS_NFE[event.manifestationType] : undefined;
  if (!tipo) {
    return { authorized: false, protocolNumber: null, rejectionReason: "Evento de manifestação sem `manifestationType` reconhecido." };
  }

  const chave = encodeURIComponent(event.fiscalDocument.accessKey!);
  const basicAuth = Buffer.from(`${decrypted.token}:`).toString("base64");

  const response = await withCircuitBreaker(FOCUS_NFE_BREAKER, () =>
    fetch(`https://api.focusnfe.com.br/v2/nfes_recebidas/${chave}/manifesto`, {
      method: "POST",
      headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(tipo === "nao_realizada" ? { tipo, justificativa: event.justification } : { tipo }),
    }),
  );

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.status === 200 || response.status === 201) {
    return {
      authorized: true,
      protocolNumber: typeof body.protocolo === "string" ? body.protocolo : null,
      rejectionReason: null,
    };
  }

  const rejectionReason =
    typeof body.mensagem === "string"
      ? body.mensagem
      : Array.isArray(body.erros)
        ? JSON.stringify(body.erros)
        : `Falha HTTP ${response.status} sem corpo de erro interpretável.`;

  return { authorized: false, protocolNumber: null, rejectionReason };
}

export async function transmitFiscalEvent(
  prisma: TenantScopedPrismaClient,
  params: { tenantId: string; fiscalDocumentEventId: string },
): Promise<FiscalEventTransmissionResult> {
  const event = await prisma.fiscalDocumentEvent.findUniqueOrThrow({
    where: { id: params.fiscalDocumentEventId },
    include: { fiscalDocument: true },
  });

  if (!event.fiscalDocument.accessKey) {
    // A Focus NFe aceita a chave de acesso como {referencia}/{chave} no path de cada
    // um dos três eventos — sem ela, não há como identificar a nota junto ao
    // provedor. Isto só pode ocorrer para documentos que nunca chegaram a ser
    // efetivamente autorizados pela SEFAZ (emitidos) ou nunca tiveram a chave
    // capturada da Distribuição DFe (recebidos), caso em que o evento nem deveria
    // ter sido tentado (guarda redundante).
    throw new FiscalDocumentMissingAccessKeyError(
      "Documento fiscal sem chave de acesso registrada — impossível identificar a nota junto à Focus NFe.",
    );
  }

  const credential = await resolveFocusNfeCredential(prisma, params.tenantId);
  if (!credential) {
    throw new FocusNfeNotConfiguredError(
      "A integração com a Focus NFe ainda não foi configurada/ativada para este tenant nem existe credencial de plataforma. Configure-a em Configurações > Integrações antes de transmitir eventos fiscais.",
    );
  }

  const decrypted = decryptFocusNfeCredential(credential);

  if (event.eventType === "RECIPIENT_MANIFESTATION") {
    return transmitRecipientManifestation(decrypted, event);
  }

  if (!event.justification) {
    // Guarda redundante: cancelFiscalDocument/issueCorrectionLetter já exigem texto
    // mínimo antes de criar o evento, então isto só ocorreria se outro fluxo criasse
    // um evento sem passar por essa validação — nunca deve chegar aqui em uso normal.
    throw new FiscalDocumentMissingAccessKeyError("Evento sem justificativa/texto registrado — não pode ser transmitido à Focus NFe.");
  }

  return transmitCancellationOrCorrectionLetter(decrypted, event);
}
