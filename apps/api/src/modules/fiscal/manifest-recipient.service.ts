// apps/api/src/modules/fiscal/manifest-recipient.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.19.4 — Manifestação do Destinatário
// (tenant como COMPRADOR de uma NF-e de fornecedor, nunca como emitente).
//
// Três gatilhos reais, todos convergindo nesta mesma função:
//   1) Automático (CIENCIA_DA_OPERACAO) — fetch-incoming-nfe.worker.ts, assim que uma
//      nova nota é capturada da Distribuição DFe, evitando o esquecimento que gera a
//      maioria dos problemas reais relatados por pequenos lojistas (crédito de ICMS
//      impugnado por falta de manifestação em até 180 dias).
//   2) Automático (CONFIRMACAO_DA_OPERACAO) — purchase-orders.routes.ts, no exato
//      instante em que o recebimento físico da mercadoria é confirmado (a ação de
//      negócio já é, por si, a evidência de que a operação ocorreu).
//   3) Manual (OPERACAO_NAO_REALIZADA/DESCONHECIMENTO_DA_OPERACAO) — rota
//      `/fiscal/notas-recebidas/:id/manifestar`, protegendo o lojista de ser
//      responsabilizado por uma NF-e emitida indevidamente em seu CNPJ.
import { TenantScopedPrismaClient } from "@filitech/db";
import { transmitFiscalEvent } from "./transmit-fiscal-event";

export class RecipientManifestationNotApplicableError extends Error {}
export class RecipientManifestationJustificationTooShortError extends Error {}
export class RecipientManifestationAlreadyFinalError extends Error {}

// Estados terminais da manifestação — uma vez atingidos, a SEFAZ não aceita um novo
// evento sobre a mesma nota (o ciclo de vida do destinatário sobre aquele documento
// está encerrado). CIENCIA_DA_OPERACAO é o único estado intermediário, que ainda
// aceita transição para qualquer um dos três estados terminais.
const TERMINAL_MANIFESTATION_TYPES = new Set(["CONFIRMACAO_DA_OPERACAO", "OPERACAO_NAO_REALIZADA", "DESCONHECIMENTO_DA_OPERACAO"]);

export async function manifestRecipientOperation(
  prisma: TenantScopedPrismaClient,
  params: {
    tenantId: string;
    fiscalDocumentId: string;
    manifestationType: "CIENCIA_DA_OPERACAO" | "CONFIRMACAO_DA_OPERACAO" | "OPERACAO_NAO_REALIZADA" | "DESCONHECIMENTO_DA_OPERACAO";
    justification?: string;
  },
) {
  const fiscalDocument = await prisma.fiscalDocument.findFirstOrThrow({
    where: { id: params.fiscalDocumentId, tenantId: params.tenantId },
  });

  if (fiscalDocument.type !== "NFE_ENTRADA") {
    throw new RecipientManifestationNotApplicableError(
      "Manifestação do Destinatário só se aplica a notas de COMPRA recebidas (o tenant é o destinatário) — este documento não é do tipo NFE_ENTRADA.",
    );
  }

  if (params.manifestationType === "OPERACAO_NAO_REALIZADA" && (!params.justification || params.justification.trim().length < 15)) {
    // Exigência real da Focus NFe/SEFAZ: justificativa obrigatória (15-255
    // caracteres) apenas para "operação não realizada" — os demais tipos não exigem.
    throw new RecipientManifestationJustificationTooShortError(
      "A manifestação de 'operação não realizada' exige uma justificativa com ao menos 15 caracteres.",
    );
  }

  const lastEvent = await prisma.fiscalDocumentEvent.findFirst({
    where: { fiscalDocumentId: fiscalDocument.id, eventType: "RECIPIENT_MANIFESTATION" },
    orderBy: { sequenceNumber: "desc" },
  });

  if (lastEvent?.manifestationType && TERMINAL_MANIFESTATION_TYPES.has(lastEvent.manifestationType) && lastEvent.status === "AUTHORIZED") {
    throw new RecipientManifestationAlreadyFinalError(
      `Esta nota já recebeu a manifestação definitiva "${lastEvent.manifestationType}" — a SEFAZ não aceita um novo evento de manifestação sobre o mesmo documento.`,
    );
  }

  const event = await prisma.fiscalDocumentEvent.create({
    data: {
      tenantId: params.tenantId,
      fiscalDocumentId: fiscalDocument.id,
      eventType: "RECIPIENT_MANIFESTATION",
      sequenceNumber: (lastEvent?.sequenceNumber ?? 0) + 1,
      manifestationType: params.manifestationType,
      justification: params.manifestationType === "OPERACAO_NAO_REALIZADA" ? params.justification!.trim() : null,
      status: "PENDING",
    },
  });

  // Mesma orquestração em duas fases do cancelamento/CC-e: a chamada de rede real à
  // Focus NFe/SEFAZ nunca ocorre dentro de uma transação de banco aberta.
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
