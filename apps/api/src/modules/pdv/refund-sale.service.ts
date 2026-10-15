// apps/api/src/modules/pdv/refund-sale.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.8 — Estorno e Cancelamento de Venda no
// PDV. O cancelamento de uma venda já fechada é o vetor de fraude interna mais comum
// do varejo (operador "cancela" uma venda paga em dinheiro após o cliente sair e
// embolsa o valor) — por isso a operação exige, estruturalmente, autorização de um
// segundo papel (PIN de Owner/Manager), nunca apenas uma confirmação do próprio
// operador.
//
// Não recebe um `tx` externo: cancelFiscalDocument já abre sua própria transação
// Prisma e, antes dela, faz uma chamada de rede real à SEFAZ — misturar uma chamada
// de rede dentro de uma transação de banco já aberta manteria locks de linha presos
// pelo tempo de resposta da SEFAZ, o antipadrão exato que o Capítulo 6 (ACID/
// concorrência) trata como erro grave. Por isso o estorno é orquestrado em duas
// fases sequenciais: (1) cancelamento fiscal, se houver documento autorizado; (2)
// transação local de estoque + status da venda, só aberta depois que a fase 1 já
// terminou com sucesso.
import { Prisma, TenantScopedPrismaClient } from "@filitech/db";
import { createModuleLogger } from "../../lib/logger";
import { verifyManagerPin } from "../auth/manager-pin.service";
import { cancelFiscalDocument } from "../fiscal/cancel-fiscal-document.service";

const logger = createModuleLogger("refund-sale");

export class RefundReasonRequiredError extends Error {}
export class RefundRequiresManagerRoleError extends Error {}
export class RefundCannotSelfAuthorizeError extends Error {}
export class OnlyPaidSalesCanBeRefundedError extends Error {}
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 8): a Fase 1 (cancelamento
// fiscal via SEFAZ) e a Fase 2 (transação local de estoque/caixa/venda) não podem
// ser uma única transação ACID — cruzam um boundary de rede real, e segurar locks
// de linha pelo tempo de resposta da SEFAZ é o antipadrão que este arquivo evita
// deliberadamente (ver comentário no topo). Isso cria, por design, uma janela onde
// a Fase 1 já comitou (FiscalDocument.status = CANCELLED, de forma durável, dentro
// da própria transação de cancelFiscalDocument) mas a Fase 2 pode falhar depois
// (ex.: crash do processo, erro de banco). Sem tratamento, essa falha subia como um
// erro genérico e o estado "fiscal cancelado, mas Sale ainda PAID/estoque não
// devolvido" ficava inconsistente e invisível para operação. Esta exceção dedicada
// sinaliza explicitamente esse caso excepcional para alarme/reconciliação manual —
// não existe forma de evitar a janela sem um padrão saga/outbox completo (fora do
// escopo deste fix pontual), mas agora ela nunca mais é silenciosa.
export class RefundLocalPhaseFailedAfterFiscalCancelError extends Error {
  constructor(
    public readonly saleId: string,
    public readonly fiscalDocumentId: string,
    public readonly cause: unknown,
  ) {
    super(
      `Estorno da venda ${saleId}: cancelamento fiscal ${fiscalDocumentId} já foi confirmado na SEFAZ, mas a ` +
        `fase local (estoque/caixa/status da venda) falhou. Estado inconsistente — requer reconciliação manual.`,
    );
  }
}

export async function refundSale(
  prisma: TenantScopedPrismaClient,
  params: { tenantId: string; saleId: string; requestedByUserId: string; reason: string; managerUserId: string; managerPin: string },
) {
  if (!params.reason?.trim()) {
    throw new RefundReasonRequiredError("Motivo do estorno é obrigatório, mesmo em ambiente de teste.");
  }

  const manager = await prisma.user.findFirstOrThrow({ where: { id: params.managerUserId, tenantId: params.tenantId, active: true } });
  if (manager.role !== "OWNER" && manager.role !== "MANAGER") {
    // RBAC (Capítulo 2) — Cashier/Technician nunca autorizam o próprio estorno.
    throw new RefundRequiresManagerRoleError("Apenas Owner ou Manager podem autorizar um estorno.");
  }
  if (manager.id === params.requestedByUserId) {
    // Mesmo um Owner operando o caixa não pode autorizar o próprio estorno sozinho.
    throw new RefundCannotSelfAuthorizeError("O mesmo usuário não pode solicitar e autorizar o próprio estorno.");
  }
  // Lança InvalidManagerPinError após 3 tentativas, com lockout de 5 minutos (mesmo
  // padrão de bloqueio de login, Capítulo 14.3).
  await verifyManagerPin(prisma, manager.id, params.managerPin);

  const sale = await prisma.sale.findFirstOrThrow({
    where: { id: params.saleId, tenantId: params.tenantId },
    include: { items: true, fiscalDocuments: true },
  });
  if (sale.status !== "PAID") {
    // Uma venda OPEN é apenas descartada, nunca "estornada".
    throw new OnlyPaidSalesCanBeRefundedError("Apenas vendas pagas podem ser estornadas.");
  }

  const authorizedFiscalDoc = sale.fiscalDocuments.find((d) => d.status === "AUTHORIZED");
  if (authorizedFiscalDoc) {
    // Fase 1 — se já existe NFC-e/NFe autorizada, o estorno de estoque/caixa só é
    // liberado DEPOIS do evento de cancelamento fiscal ser protocolado com sucesso
    // na SEFAZ (Capítulo 21.19) — nunca em paralelo e nunca antes, para que
    // documento fiscal e estado interno nunca divirjam. Se a SEFAZ rejeitar (ex.:
    // prazo expirado), a exceção lançada por cancelFiscalDocument interrompe o
    // estorno inteiro antes da Fase 2.
    await cancelFiscalDocument(prisma, {
      tenantId: params.tenantId,
      fiscalDocumentId: authorizedFiscalDoc.id,
      justification: params.reason,
    });
  }

  // Fase 2 — agora sim, uma única transação local de banco para estoque + status da
  // venda, sem nenhuma chamada de rede dentro dela (igual ao padrão FIFO do
  // Capítulo 6.2).
  try {
    return await prisma.$transaction(async (tx) => {
    // Transição atômica PAID -> REFUNDED primeiro: dois estornos concorrentes da mesma
    // venda nunca devolvem o estoque duas vezes (o segundo vê count 0 e é rejeitado).
    const transition = await tx.sale.updateMany({
      where: { id: sale.id, tenantId: params.tenantId, status: "PAID" },
      data: {
        status: "REFUNDED",
        refundReason: params.reason,
        refundedByUserId: params.requestedByUserId,
        refundAuthorizedByUserId: manager.id,
        refundedAt: new Date(),
      },
    });
    if (transition.count === 0) {
      throw new OnlyPaidSalesCanBeRefundedError("Apenas vendas pagas podem ser estornadas.");
    }

    // Gap de auditoria (Capítulo 4.6 — Comanda Eletrônica): `SaleItem.productId`
    // passou a ser opcional para suportar itens de serviço (`serviceId`) vindos de
    // uma Comanda fechada. Itens de serviço não têm estoque físico e nunca geram
    // StockMovement/estorno de estoque.
    for (const item of sale.items) {
      if (!item.productId) continue;
      await tx.stockMovement.create({
        data: {
          tenantId: params.tenantId,
          productId: item.productId,
          type: "RETURN",
          quantity: item.quantity,
          referenceId: sale.id,
        },
      });
      await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: { increment: item.quantity } } });
    }

    // GAP DE AUDITORIA FECHADO (Capítulo 6.8, Rodada 15): até aqui o estorno mudava
    // apenas `Sale.status`, mas nunca os `Payment`s nem a gaveta de caixa — o
    // fechamento de caixa (`closeCashRegister`) somava TODOS os pagamentos CASH com
    // status CONFIRMED da venda, inclusive de vendas já estornadas, inflando o valor
    // esperado em dinheiro mesmo depois do dinheiro já ter saído fisicamente da
    // gaveta na devolução ao cliente.
    const payments = await tx.payment.findMany({ where: { saleId: sale.id, tenantId: params.tenantId, status: "CONFIRMED" } });

    await tx.payment.updateMany({
      where: { saleId: sale.id, tenantId: params.tenantId, status: "CONFIRMED" },
      data: { status: "REFUNDED" },
    });

    // Dinheiro devolvido fisicamente ao cliente sai da gaveta como uma sangria
    // automática (mesmo ledger imutável de `CashRegisterMovement` usado para
    // sangria/suprimento manual) — sem isto, `expectedAmount` do fechamento de
    // caixa continuaria contando esse dinheiro como se ainda estivesse na gaveta.
    const refundedCash = payments.filter((p) => p.method === "CASH").reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));
    if (refundedCash.greaterThan(0)) {
      await tx.cashRegisterMovement.create({
        data: {
          cashRegisterId: sale.cashRegisterId,
          type: "WITHDRAWAL",
          amount: refundedCash,
          reason: `Estorno da venda #${sale.id.slice(0, 8)} — devolução em espécie ao cliente`,
          performedByUserId: manager.id,
        },
      });
    }

    // Crediário/fiado (STORE_CREDIT) e faturas de convênio pendentes vinculadas a
    // esta venda deixam de ser cobráveis — cancela a AccountReceivable em aberto
    // para não gerar cobrança de uma venda que não existe mais.
    await tx.accountReceivable.updateMany({
      where: { saleId: sale.id, tenantId: params.tenantId, status: { in: ["PENDING", "OVERDUE"] } },
      data: { status: "CANCELLED" },
    });

    return tx.sale.findUniqueOrThrow({ where: { id: sale.id } });
    });
  } catch (err) {
    if (authorizedFiscalDoc) {
      // A SEFAZ já confirmou o cancelamento (Fase 1 comitou de forma durável) antes
      // desta transação sequer começar — não é um simples "rollback e tente de
      // novo", é um estado divergente entre o documento fiscal (já CANCELLED) e o
      // restante do sistema (ainda como se a venda estivesse PAID). Loga como
      // erro crítico para alarme/reconciliação manual, nunca engolindo a falha.
      logger.error(
        { saleId: sale.id, fiscalDocumentId: authorizedFiscalDoc.id, err },
        "Estorno: fase local falhou após cancelamento fiscal já confirmado na SEFAZ — estado inconsistente, requer reconciliação manual",
      );
      throw new RefundLocalPhaseFailedAfterFiscalCancelError(sale.id, authorizedFiscalDoc.id, err);
    }
    throw err;
  }
}
