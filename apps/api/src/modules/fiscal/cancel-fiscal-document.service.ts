// apps/api/src/modules/fiscal/cancel-fiscal-document.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.19.2 — Cancelamento de documento fiscal,
// regra de prazo real da SEFAZ (Ajuste SINIEF) e bloqueio automático fora do prazo.
import { PrismaClient } from "@filitech/db";
import { transmitFiscalEvent } from "./transmit-fiscal-event";

// Prazos reais da SEFAZ (padrão nacional, cada UF pode SÓ reduzir, nunca ampliar).
// FiscalDocumentType real do schema é { NFCE, NFE_SAIDA, NFE_ENTRADA } — NFE_ENTRADA
// (nota de compra recebida) nunca é cancelada por este fluxo (o emitente é o
// fornecedor, não o tenant), por isso não recebe prazo de cancelamento próprio aqui.
//
// CORREÇÃO DE AUDITORIA (pesquisa web confirmada): o Ajuste SINIEF 07/2018 reduziu o
// prazo de cancelamento da NFC-e de 24h para apenas 30 MINUTOS após a autorização de
// uso — valor nacional máximo, estados só podem encurtar, nunca ampliar. O valor
// anterior (24h) estava desatualizado/incorreto e foi corrigido aqui e na Bible
// (Capítulo 21.19.2). Existe ainda o "cancelamento por substituição" (NT 2018.004,
// Ajuste SINIEF 19/2016), janela de até 168h, mas só para duplicidade de NFC-e em
// contingência referenciando a nota nova — fora do escopo deste fluxo de cancelamento
// simples, que trata apenas do evento 110111 padrão.
const CANCELLATION_DEADLINE_HOURS: Record<"NFCE" | "NFE_SAIDA", number> = {
  NFCE: 0.5, // NFC-e (varejo de balcão) — 30 minutos (Ajuste SINIEF 07/2018)
  NFE_SAIDA: 24, // NF-e modelo 55 (B2B/interestadual) — 24h (Ajuste SINIEF 07/05); cancelamento
  // extemporâneo além disso (até 480h/20 dias) depende de autorização discricionária
  // da SEFAZ estadual, não é um direito automático — por isso NÃO é usado como prazo
  // padrão aqui, apenas a janela garantida nacionalmente.
};

export class CancellationJustificationTooShortError extends Error {}
export class OnlyAuthorizedDocumentsCanBeCancelledError extends Error {}
export class CancellationNotApplicableToDocumentTypeError extends Error {}
export class CancellationDeadlineExpiredError extends Error {}

export async function cancelFiscalDocument(
  prisma: PrismaClient,
  params: { tenantId: string; fiscalDocumentId: string; justification: string },
) {
  if (params.justification.trim().length < 15) {
    // Exigência mínima real do schema XML da SEFAZ (campo xJust do evento 110111).
    throw new CancellationJustificationTooShortError("A justificativa do cancelamento deve ter ao menos 15 caracteres.");
  }

  const fiscalDocument = await prisma.fiscalDocument.findFirstOrThrow({
    where: { id: params.fiscalDocumentId, tenantId: params.tenantId },
  });

  if (fiscalDocument.status !== "AUTHORIZED") {
    throw new OnlyAuthorizedDocumentsCanBeCancelledError("Apenas documentos fiscais autorizados podem ser cancelados.");
  }

  if (fiscalDocument.type !== "NFCE" && fiscalDocument.type !== "NFE_SAIDA") {
    throw new CancellationNotApplicableToDocumentTypeError(
      `Documentos do tipo ${fiscalDocument.type} não são cancelados por este fluxo.`,
    );
  }

  const deadlineHours = CANCELLATION_DEADLINE_HOURS[fiscalDocument.type];
  const hoursSinceAuthorization = (Date.now() - fiscalDocument.createdAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceAuthorization > deadlineHours) {
    // Fora do prazo legal de cancelamento simples — a única via restante é a emissão
    // de uma NF-e/NFC-e de DEVOLUÇÃO (fluxo de venda inverso, CFOP 1202/2202), nunca
    // um cancelamento forçado que violaria o Ajuste SINIEF.
    throw new CancellationDeadlineExpiredError(
      "Prazo legal de cancelamento expirado. Emita um documento fiscal de devolução em vez de cancelar.",
    );
  }

  const lastEvent = await prisma.fiscalDocumentEvent.findFirst({
    where: { fiscalDocumentId: fiscalDocument.id, eventType: "CANCELLATION" },
    orderBy: { sequenceNumber: "desc" },
  });

  const event = await prisma.fiscalDocumentEvent.create({
    data: {
      tenantId: params.tenantId,
      fiscalDocumentId: fiscalDocument.id,
      eventType: "CANCELLATION",
      sequenceNumber: (lastEvent?.sequenceNumber ?? 0) + 1,
      justification: params.justification,
      status: "PENDING",
    },
  });

  // Monta/assina/transmite o XML do evento (tpEvento=110111) — nunca síncrono dentro
  // de uma transação de banco (a chamada de rede real à SEFAZ ficaria segurando
  // locks de linha pelo tempo de resposta do provedor, o antipadrão que o Capítulo 6
  // trata como erro grave). O evento já foi persistido como PENDING acima; se a
  // transmissão falhar/lançar, o evento permanece PENDING para nova tentativa manual,
  // nunca em um estado ambíguo.
  const sefazResponse = await transmitFiscalEvent(prisma, { tenantId: params.tenantId, fiscalDocumentEventId: event.id });

  return prisma.$transaction([
    prisma.fiscalDocumentEvent.update({
      where: { id: event.id },
      data: {
        status: sefazResponse.authorized ? "AUTHORIZED" : "REJECTED",
        protocolNumber: sefazResponse.protocolNumber,
        rejectionReason: sefazResponse.rejectionReason,
      },
    }),
    ...(sefazResponse.authorized
      ? [
          prisma.fiscalDocument.update({ where: { id: fiscalDocument.id }, data: { status: "CANCELLED" as const } }),
          ...(fiscalDocument.saleId
            ? [prisma.sale.update({ where: { id: fiscalDocument.saleId }, data: { fiscalStatus: "CANCELLED_AFTER_AUTHORIZATION" } })]
            : []),
        ]
      : []),
  ]);
}
