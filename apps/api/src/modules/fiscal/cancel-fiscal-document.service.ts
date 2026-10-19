// apps/api/src/modules/fiscal/cancel-fiscal-document.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.19.2 — Cancelamento de documento fiscal,
// regra de prazo real da SEFAZ (Ajuste SINIEF) e bloqueio automático fora do prazo.
import { TenantScopedPrismaClient } from "@filitech/db";
import { transmitFiscalEvent } from "./transmit-fiscal-event";

// Prazos reais da SEFAZ (padrão nacional, cada UF pode SÓ reduzir, nunca ampliar).
// FiscalDocumentType real do schema é { NFCE, NFE_SAIDA, NFE_ENTRADA, NFSE } —
// NFE_ENTRADA (nota de compra recebida) nunca é cancelada por este fluxo (o
// emitente é o fornecedor, não o tenant); NFSE (ISS, Capítulo 21.8) tem prazo e
// procedimento de cancelamento definidos por cada prefeitura (sem padrão nacional
// único como o Ajuste SINIEF da NFC-e) — cancelamento de NFS-e fica documentado
// como gap de escopo explícito (`CancellationNotApplicableToDocumentTypeError`
// abaixo), nunca tratado silenciosamente como NFC-e.
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
// fa-fiscal-cancel-cce-double-submit: duas requisições concorrentes de cancelamento
// (duplo clique, retry de rede do frontend, duas abas) liam o mesmo `lastEvent`,
// calculavam o MESMO `sequenceNumber` e ambas chegavam a transmitir o evento
// 110111 à SEFAZ — risco real de rejeição por duplicidade de evento ou, pior, de
// duas transmissões "bem-sucedidas" divergentes. Agora bloqueado por
// `pg_advisory_xact_lock` + checagem de evento ativo (ver abaixo).
export class CancellationAlreadyInProgressError extends Error {}

export async function cancelFiscalDocument(
  prisma: TenantScopedPrismaClient,
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
  // CORREÇÃO DE AUDITORIA (mega-audit rodada 5): o prazo contava a partir de
  // `createdAt` (criação local do registro PENDING), nunca do instante real de
  // autorização na SEFAZ (`authorizedAt`). Documentos antigos (anteriores a esta
  // correção) podem não ter `authorizedAt` preenchido por falha de backfill — nesse
  // caso extremo, cai em `createdAt` apenas como último recurso, nunca permitindo
  // silenciosamente um cancelamento sem nenhuma verificação de prazo.
  const referenceTimestamp = fiscalDocument.authorizedAt ?? fiscalDocument.createdAt;
  const hoursSinceAuthorization = (Date.now() - referenceTimestamp.getTime()) / (1000 * 60 * 60);
  if (hoursSinceAuthorization > deadlineHours) {
    // Fora do prazo legal de cancelamento simples — a única via restante é a emissão
    // de uma NF-e/NFC-e de DEVOLUÇÃO (fluxo de venda inverso, CFOP 1202/2202), nunca
    // um cancelamento forçado que violaria o Ajuste SINIEF.
    throw new CancellationDeadlineExpiredError(
      "Prazo legal de cancelamento expirado. Emita um documento fiscal de devolução em vez de cancelar.",
    );
  }

  // fa-fiscal-cancel-cce-double-submit: o "ler lastEvent → calcular sequenceNumber →
  // create" inteiro roda dentro de uma transação serializada por
  // `pg_advisory_xact_lock(hashtext(...))` — mesmo padrão já usado em
  // seat-billing.service.ts/scheduling.routes.ts. O lock é por-transação (liberado
  // automaticamente no commit/rollback) e serializa exatamente as requisições
  // concorrentes para o MESMO fiscalDocumentId, nunca bloqueando cancelamentos de
  // documentos diferentes. Dentro do lock, confirmamos que não existe nenhum evento
  // de cancelamento ainda ativo (PENDING aguardando resposta da SEFAZ, ou já
  // AUTHORIZED) antes de criar um novo — isso é o que de fato impede o duplo envio,
  // não apenas a unicidade de sequenceNumber (que duas transações concorrentes sem
  // lock poderiam calcular de forma diferente e ambas "passar").
  const event = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fiscalDocument.id} || ':cancellation'))`;

    const activeEvent = await tx.fiscalDocumentEvent.findFirst({
      where: {
        fiscalDocumentId: fiscalDocument.id,
        eventType: "CANCELLATION",
        status: { in: ["PENDING", "AUTHORIZED"] },
      },
    });
    if (activeEvent) {
      throw new CancellationAlreadyInProgressError(
        `Já existe um cancelamento ${activeEvent.status === "AUTHORIZED" ? "concluído" : "em andamento"} para este documento fiscal — evite reenviar a solicitação.`,
      );
    }

    const lastEvent = await tx.fiscalDocumentEvent.findFirst({
      where: { fiscalDocumentId: fiscalDocument.id, eventType: "CANCELLATION" },
      orderBy: { sequenceNumber: "desc" },
    });

    return tx.fiscalDocumentEvent.create({
      data: {
        tenantId: params.tenantId,
        fiscalDocumentId: fiscalDocument.id,
        eventType: "CANCELLATION",
        sequenceNumber: (lastEvent?.sequenceNumber ?? 0) + 1,
        justification: params.justification,
        status: "PENDING",
      },
    });
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
