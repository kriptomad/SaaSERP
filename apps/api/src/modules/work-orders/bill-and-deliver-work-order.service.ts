// apps/api/src/modules/work-orders/bill-and-deliver-work-order.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.2 — "DELIVERED (pagamento + nota + termo
// de garantia entregue)". GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: a transição
// READY → DELIVERED existia desde sempre em work-orders.routes.ts, mas só gravava
// `status`/`deliveredAt` — nenhum pagamento, nenhuma Sale, nenhum FiscalDocument
// jamais era criado. Uma O.S. inteira (peças + mão de obra) podia ser "entregue"
// sem nunca gerar receita/tributo registrado no sistema.
//
// Espelha fielmente o padrão já auditado de `comanda.routes.ts` (fechamento de
// comanda mista produto+serviço): uma única transação Serializable cria a Sale +
// Payment + até dois FiscalDocument (NFCE para peças, NFSE para mão de obra),
// e a emissão real via Focus NFe é sempre enfileirada DEPOIS do commit (nunca
// dentro da transação, para não segurar lock de estoque esperando rede externa).
//
// Dualidade de tributo (Capítulo 21.1, linha "Assistência Técnica/Informática"):
// "Uma única O.S. pode gerar dois tributos distintos — a baixa do WorkOrderItem
// precisa distinguir item de serviço vs. item de peça para rotear o CFOP correto."
// `itemType = "PART"` → ICMS/IBS/CBS (calculateTax, mesma rota de mercadoria);
// `itemType = "LABOR"` → ISS (calculateIss, nicheCode fixo "TECH_ASSISTANCE" — o
// módulo WORK_ORDER não tem um `Service` próprio como Salão/Petshop/Lava-Rápido,
// Capítulo 11.6, então não há NBS/serviço individual para rotear; o lojista
// cadastra a TaxRule do nicho "TECH_ASSISTANCE" em Cadastros > Regras Fiscais,
// mesmo fluxo já exigido para qualquer outro nicho de serviço).
//
// Estoque: nenhuma rota do módulo de O.S. jamais decrementa `Product.stockQuantity`
// ao lançar um `WorkOrderItem` (confirmado por auditoria — peças ficam "lançadas"
// mas nunca saem fisicamente do estoque). Para não introduzir um decremento duplo
// no futuro nem deixar a peça fantasma no estoque para sempre, o decremento real
// acontece exatamente AQUI, no único momento em que a O.S. se torna irreversível
// (entrega + cobrança) — mesma escolha de design de `comanda.routes.ts`.
import { Prisma, SalePaymentMethod, TenantScopedPrismaClient } from "@filitech/db";
import { calculateTax, calculateIss } from "../fiscal/tax-engine.service";
import { resolveTaxReformPhase } from "../fiscal/tax-reform-phase.service";

export class WorkOrderNotFoundError extends Error {}
export class WorkOrderNotReadyForDeliveryError extends Error {}
export class WorkOrderHasNoBillableItemsError extends Error {}
// CORREÇÃO DE AUDITORIA (fa-workorder-checklist-no-schema): a transição para
// entrega/faturamento só checava `status === "READY"`, nunca se o checklist de
// entrega (etapa DELIVERY, com assinatura do cliente) de fato existia — uma O.S.
// podia ser "entregue e faturada" sem nenhum registro de que o cliente conferiu/
// aceitou o equipamento na retirada.
export class WorkOrderChecklistIncompleteError extends Error {}

export interface BillAndDeliverWorkOrderInput {
  tenantId: string;
  workOrderId: string;
  cashierId: string;
  cashRegisterId: string;
  paymentMethod: SalePaymentMethod;
}

export async function billAndDeliverWorkOrder(prisma: TenantScopedPrismaClient, input: BillAndDeliverWorkOrderInput) {
  const result = await prisma.$transaction(
    async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: { id: input.workOrderId, tenantId: input.tenantId },
        include: { items: { include: { product: true } } },
      });
      if (!workOrder) throw new WorkOrderNotFoundError("Ordem de serviço não encontrada.");
      if (workOrder.status !== "READY") {
        throw new WorkOrderNotReadyForDeliveryError("Só é possível entregar/faturar uma O.S. com status READY (checklist de saída e laudo final já concluídos).");
      }
      if (workOrder.items.length === 0) {
        throw new WorkOrderHasNoBillableItemsError("Não é possível faturar uma O.S. sem nenhum item de peça ou mão de obra lançado.");
      }

      // CORREÇÃO DE AUDITORIA (fa-workorder-checklist-no-schema): o status READY
      // por si só não prova que o checklist de entrega foi preenchido — exige a
      // existência de um `OsChecklist` da etapa DELIVERY, com assinatura do
      // cliente, ANTES de permitir o efeito irreversível desta função (Sale +
      // Payment + FiscalDocument + status DELIVERED). O schema por etapa
      // (work-orders.routes.ts) já garante que, uma vez criado, esse checklist tem
      // todos os campos obrigatórios preenchidos — aqui só confirmamos que ele
      // existe para esta O.S.
      const deliveryChecklist = await tx.osChecklist.findFirst({
        where: { tenantId: input.tenantId, workOrderId: workOrder.id, stage: "DELIVERY" },
        orderBy: { createdAt: "desc" },
      });
      if (!deliveryChecklist || !deliveryChecklist.clientSignatureUrl) {
        throw new WorkOrderChecklistIncompleteError(
          "Não é possível entregar/faturar esta O.S. sem o checklist de entrega (etapa DELIVERY) preenchido e assinado pelo cliente.",
        );
      }

      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { taxRegime: true, uf: true } });

      let totalAmount = new Prisma.Decimal(0);
      let legacyIcmsTotal = new Prisma.Decimal(0);
      let legacyPisCofinsTotal = new Prisma.Decimal(0);
      let ibsTotal = new Prisma.Decimal(0);
      let cbsTotal = new Prisma.Decimal(0);
      let selectiveTaxTotal = new Prisma.Decimal(0);
      let issTotal = new Prisma.Decimal(0);
      let issRetidoNaFonte = false;
      let hasPartItem = false;
      let hasLaborItem = false;
      const saleItemsData: Prisma.SaleItemCreateManySaleInput[] = [];

      for (const item of workOrder.items) {
        const lineGross = item.unitPrice.times(item.quantity);
        totalAmount = totalAmount.plus(lineGross);

        if (item.itemType === "PART") {
          hasPartItem = true;
          if (item.productId && item.product) {
            // Baixa real de estoque — única no ciclo de vida inteiro da O.S. (ver
            // comentário de topo do arquivo: nenhuma outra rota decrementa).
            await tx.product.update({ where: { id: item.product.id }, data: { stockQuantity: { decrement: item.quantity } } });
            await tx.stockMovement.create({
              data: { tenantId: input.tenantId, productId: item.product.id, type: "SALE_OUT", quantity: item.quantity.negated(), referenceId: workOrder.id },
            });
            const taxResult = await calculateTax(tx, {
              tenantId: input.tenantId,
              ncm: item.product.ncm ?? "00000000",
              uf: item.product.originUf ?? tenant.uf ?? "SP",
              nicheCode: item.product.nicheCode ?? "TECH_ASSISTANCE",
              grossAmount: lineGross,
            });
            legacyIcmsTotal = legacyIcmsTotal.plus(taxResult.legacyIcmsAmount);
            legacyPisCofinsTotal = legacyPisCofinsTotal.plus(taxResult.legacyPisCofinsAmount);
            ibsTotal = ibsTotal.plus(taxResult.ibsAmount);
            cbsTotal = cbsTotal.plus(taxResult.cbsAmount);
            selectiveTaxTotal = selectiveTaxTotal.plus(taxResult.selectiveTaxAmount);
          } else {
            // Peça avulsa sem cadastro de Product (ex.: componente de terceiro
            // comprado especificamente para este reparo) — sem estoque a baixar,
            // mas o ICMS/IBS/CBS ainda incide sobre a venda da peça ao cliente.
            const taxResult = await calculateTax(tx, {
              tenantId: input.tenantId,
              ncm: "00000000",
              uf: tenant.uf ?? "SP",
              nicheCode: "TECH_ASSISTANCE",
              grossAmount: lineGross,
            });
            legacyIcmsTotal = legacyIcmsTotal.plus(taxResult.legacyIcmsAmount);
            legacyPisCofinsTotal = legacyPisCofinsTotal.plus(taxResult.legacyPisCofinsAmount);
            ibsTotal = ibsTotal.plus(taxResult.ibsAmount);
            cbsTotal = cbsTotal.plus(taxResult.cbsAmount);
            selectiveTaxTotal = selectiveTaxTotal.plus(taxResult.selectiveTaxAmount);
          }
        } else {
          // itemType === "LABOR"
          hasLaborItem = true;
          const issResult = await calculateIss(tx, {
            tenantId: input.tenantId,
            nbs: null,
            uf: tenant.uf ?? "SP",
            nicheCode: "TECH_ASSISTANCE",
            grossAmount: lineGross,
          });
          issTotal = issTotal.plus(issResult.issAmount);
          issRetidoNaFonte = issRetidoNaFonte || issResult.issRetidoNaFonte;
        }

        saleItemsData.push({
          tenantId: input.tenantId,
          productId: item.productId ?? undefined,
          description: item.productId ? undefined : item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: lineGross,
        });
      }

      const sale = await tx.sale.create({
        data: {
          tenantId: input.tenantId,
          cashierId: input.cashierId,
          cashRegisterId: input.cashRegisterId,
          idempotencyKey: `work-order:${workOrder.id}`,
          paymentMethod: input.paymentMethod,
          status: "PAID",
          channel: "COUNTER",
          totalAmount,
          items: { createMany: { data: saleItemsData } },
        },
      });

      await tx.payment.create({
        data: { tenantId: input.tenantId, saleId: sale.id, method: input.paymentMethod, status: "CONFIRMED", amount: totalAmount, changeDue: new Prisma.Decimal(0), idempotencyKey: `work-order:${workOrder.id}:payment` },
      });

      let fiscalDocument = null;
      if (hasPartItem) {
        fiscalDocument = await tx.fiscalDocument.create({
          data: {
            tenantId: input.tenantId,
            type: "NFCE",
            status: "PENDING",
            saleId: sale.id,
            legacyIcmsAmount: legacyIcmsTotal,
            legacyPisCofinsAmount: legacyPisCofinsTotal,
            ibsAmount: ibsTotal,
            cbsAmount: cbsTotal,
            selectiveTaxAmount: selectiveTaxTotal,
            totalTaxesApprox: legacyIcmsTotal.plus(legacyPisCofinsTotal).plus(ibsTotal).plus(cbsTotal).plus(selectiveTaxTotal),
            taxRegimeSnapshot: tenant.taxRegime,
            faseReformaTributaria: resolveTaxReformPhase(new Date()),
          },
        });
      }

      let serviceFiscalDocument = null;
      if (hasLaborItem) {
        serviceFiscalDocument = await tx.fiscalDocument.create({
          data: {
            tenantId: input.tenantId,
            type: "NFSE",
            status: "PENDING",
            saleId: sale.id,
            issAmount: issTotal,
            issRetidoNaFonte,
            totalTaxesApprox: issTotal,
            taxRegimeSnapshot: tenant.taxRegime,
            faseReformaTributaria: resolveTaxReformPhase(new Date()),
          },
        });
      }

      const deliveredWorkOrder = await tx.workOrder.update({
        where: { id: workOrder.id },
        data: { status: "DELIVERED", deliveredAt: new Date(), billingSaleId: sale.id },
      });

      return { workOrder: deliveredWorkOrder, sale, fiscalDocument, serviceFiscalDocument };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return result;
}
