// apps/api/src/modules/fiscal/issue-correction-letter.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.19.3 — Carta de Correção Eletrônica (CC-e).
//
// CORREÇÃO DE AUDITORIA (pesquisa web confirmada, doc.focusnfe.com.br/reference/emitir_carta_correcao):
// a CC-e (evento 110110) é legalmente vedada para NFC-e modelo 65 — a SEFAZ rejeita
// com o código "784 - Rejeição: NFC-e não permite evento Carta de Correção
// Eletrônica" (apenas cancelamento é um evento válido para NFC-e). O padrão NFS-e
// municipal (ISS, Capítulo 21.8) também não usa CC-e — cada prefeitura tem seu
// próprio mecanismo de substituição/cancelamento de RPS, sem um evento SEFAZ
// unificado. Por isso esta função só aceita `FiscalDocument.type === "NFE_SAIDA"`
// (NF-e modelo 55, B2B/interestadual) — a única emissão real sujeita a CC-e neste
// sistema. Isto não é um gap: é a regra fiscal real sendo respeitada, nunca uma
// função "genérica" que mentiria sucesso para um documento que a SEFAZ rejeitaria.
import { TenantScopedPrismaClient } from "@filitech/db";
import { transmitFiscalEvent } from "./transmit-fiscal-event";

export class CorrectionLetterNotApplicableToDocumentTypeError extends Error {}
export class CorrectionLetterCannotAlterValuesTaxesOrDatesError extends Error {}
export class CorrectionLetterTextOutOfBoundsError extends Error {}
export class OnlyAuthorizedDocumentsAcceptCorrectionLetterError extends Error {}

// § 1º-A do Ajuste SINIEF 07/05: a CC-e nunca pode alterar valores, tributos,
// quantidades, datas de emissão ou dados do destinatário que configurem nova
// operação — qualquer uma dessas correções exige cancelamento + reemissão. O
// formulário do painel do tenant cita este artigo exato ao rejeitar a tentativa,
// para o lojista entender por que não pode simplesmente "editar a nota".
const FORBIDDEN_PATTERNS = [/valor/i, /quantidade/i, /tribut/i, /icms/i, /ibs/i, /cbs/i, /data de emiss/i, /destinat[aá]rio/i];

export async function issueCorrectionLetter(
  prisma: TenantScopedPrismaClient,
  params: { tenantId: string; fiscalDocumentId: string; correctionText: string },
) {
  const text = params.correctionText.trim();
  if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new CorrectionLetterCannotAlterValuesTaxesOrDatesError(
      "A Carta de Correção não pode alterar valor, tributo, quantidade, data de emissão ou dados do destinatário (§ 1º-A do Ajuste SINIEF 07/05). Corrija apenas dados textuais/cadastrais não essenciais, ou cancele e reemita a nota.",
    );
  }
  if (text.length < 15 || text.length > 1000) {
    // Limite real do schema XML do evento 110110 da SEFAZ.
    throw new CorrectionLetterTextOutOfBoundsError("O texto da correção deve ter entre 15 e 1000 caracteres.");
  }

  const fiscalDocument = await prisma.fiscalDocument.findFirstOrThrow({
    where: { id: params.fiscalDocumentId, tenantId: params.tenantId },
  });

  if (fiscalDocument.status !== "AUTHORIZED") {
    throw new OnlyAuthorizedDocumentsAcceptCorrectionLetterError("Apenas documentos fiscais autorizados podem receber Carta de Correção.");
  }

  if (fiscalDocument.type !== "NFE_SAIDA") {
    throw new CorrectionLetterNotApplicableToDocumentTypeError(
      fiscalDocument.type === "NFCE"
        ? "NFC-e (modelo 65) não aceita Carta de Correção Eletrônica — a SEFAZ rejeita este evento com o código 784. Emita uma NF-e de devolução/cancelamento em vez disso."
        : `Documentos do tipo ${fiscalDocument.type} não aceitam Carta de Correção Eletrônica por este fluxo.`,
    );
  }

  const lastEvent = await prisma.fiscalDocumentEvent.findFirst({
    where: { fiscalDocumentId: fiscalDocument.id, eventType: "CORRECTION_LETTER" },
    orderBy: { sequenceNumber: "desc" },
  });

  // A SEFAZ aceita até 20 CC-e por nota, sendo que apenas a última é válida — este
  // limite é verificado aqui (nunca silenciosamente ignorado) porque uma 21ª
  // tentativa seria rejeitada pela própria SEFAZ sem nenhum ganho real para o lojista.
  const nextSequence = (lastEvent?.sequenceNumber ?? 0) + 1;
  if (nextSequence > 20) {
    throw new CorrectionLetterNotApplicableToDocumentTypeError(
      "Limite de 20 Cartas de Correção por nota já atingido (regra nacional da SEFAZ). Apenas a última CC-e emitida continua válida.",
    );
  }

  const event = await prisma.fiscalDocumentEvent.create({
    data: {
      tenantId: params.tenantId,
      fiscalDocumentId: fiscalDocument.id,
      eventType: "CORRECTION_LETTER",
      sequenceNumber: nextSequence,
      justification: text,
      status: "PENDING",
    },
  });

  // Mesma orquestração em duas fases do cancelamento (cancel-fiscal-document.service.ts):
  // a chamada de rede real à Focus NFe/SEFAZ nunca ocorre dentro de uma transação de
  // banco aberta, para não segurar locks de linha pela latência do provedor.
  const sefazResponse = await transmitFiscalEvent(prisma, { tenantId: params.tenantId, fiscalDocumentEventId: event.id });

  return prisma.fiscalDocumentEvent.update({
    where: { id: event.id },
    data: {
      status: sefazResponse.authorized ? "AUTHORIZED" : "REJECTED",
      protocolNumber: sefazResponse.protocolNumber,
      rejectionReason: sefazResponse.rejectionReason,
    },
  });
}
