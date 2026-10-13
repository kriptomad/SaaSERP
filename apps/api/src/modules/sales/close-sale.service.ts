// apps/api/src/modules/sales/close-sale.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.6 — Fechamento Transacional da Venda, o
// orquestrador real por trás de POST /api/sales (Capítulo 9.5). Único ponto do sistema
// que transiciona uma venda de "recebida" para "paga e fiscalmente registrada",
// unificando: (1) idempotência, (2) dedução de estoque roteada pelo trackingType do
// produto, (3) cálculo tributário real via TaxEngine, e (4) enfileiramento da emissão
// fiscal (fora da transação de banco).
import { Prisma, PrismaClient } from "@filitech/db";
import { calculateTax } from "../fiscal/tax-engine.service";
import { resolveTaxReformPhase } from "../fiscal/tax-reform-phase.service";
import { deductStockFefoWithinTx } from "../../services/stock/deduct-stock-fefo.service";
import { InsufficientStockError } from "../../services/stock/deduct-stock-fefo.service";
import { enqueueFiscalEmission } from "../fiscal/queues/fiscal-emission.queue";
import { accrueLoyaltyPoints } from "../loyalty/accrue-loyalty-points.service";

// Capítulo 11.2 — Ótica: prazo de entrega do laboratório é descrito em DIAS ÚTEIS
// (1-2 para lente de prateleira, 3-10+ para personalizada) — aproximação simples de
// segunda a sexta, sem calendário de feriados (mesmo nível de precisão dos outros
// helpers de data já existentes no código, ex.: `addDays` em dunning.service.ts/
// accrue-loyalty-points.service.ts).
function addBusinessDays(base: Date, days: number): Date {
  const result = new Date(base);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) remaining--;
  }
  return result;
}

// Garantia legal CDC (90 dias corridos, não úteis — art. 26, II) + garantia
// contratual adicional, também em dias corridos.
function addCalendarDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result;
}

export interface CloseSaleServerInput {
  tenantId: string;
  idempotencyKey: string;
  cashRegisterId: string;
  cashierId: string;
  // Capítulo 4.1.1 — venda identificada pelo CPF/CNPJ na nota, usada para creditar
  // pontos de fidelidade (EARN); clientId já validado como pertencente ao tenant
  // por quem chama este serviço (sales.routes.ts), nunca confiado cru aqui.
  clientId?: string | null;
  items: {
    productId: string;
    quantity: number;
    unitPrice: number;
    serialNumber?: string;
    productVariantId?: string;
    // Farmácia/Drogaria (Capítulo 4.5 — Portaria 344/1998, RDC 1.000/2025): obrigatório
    // quando `product.requiresPrescriptionRetention = true`. Sem isso, a venda nunca é
    // concluída (ver trava logo abaixo, dentro do loop de itens).
    prescriptionData?: {
      prescriptionType: "NOTIFICACAO_B_AZUL" | "RECEITA_A_AMARELA" | "RECEITA_ELETRONICA_SNCR";
      patientDocument: string;
      electronicPrescriptionNumber?: string;
      retainedDocumentStorageKey?: string;
    };
    // Capítulo 11.2 — Ótica: obrigatório quando o item vendido é
    // `Product.opticsCategory = LENS` — a O.S. de laboratório óptico aberta
    // automaticamente no fechamento desta venda referencia a receita usada.
    opticalPrescriptionId?: string;
  }[];
  paymentMethod: "CASH" | "DEBIT_CARD" | "CREDIT_CARD" | "PIX" | "BOLETO" | "STORE_CREDIT" | "HEALTH_INSURANCE";
  amountTendered?: number;
}

export class SerialNotReadyForSaleError extends Error {}
export class SerialNotFoundError extends Error {}
export class CashRegisterNotFoundError extends Error {}
export class VariantRequiredError extends Error {}
export class VariantNotFoundError extends Error {}
export class InsufficientVariantStockError extends Error {}
// Capítulo 4.6 — Varejo Geral (Crediário/Fiado): GAP DE AUDITORIA ENCONTRADO E
// CORRIGIDO. `paymentMethod: STORE_CREDIT` já era aceito pelo tipo, mas nenhuma
// validação contra `Client.creditLimit`/`creditBalanceUsed` existia — a regra de
// negócio central do nicho (bloqueio automático de crediário) simplesmente não
// existia, era só um valor de enum aceito sem lógica alguma por trás.
export class ClientRequiredForStoreCreditError extends Error {}
export class CreditLimitExceededError extends Error {}
// Capítulo 4.5 — Farmácia/Drogaria: trava regulatória SNGPC/SNCR. GAP DE AUDITORIA
// ENCONTRADO: `Product.requiresPrescriptionRetention` e `PrescriptionRecord` existiam
// no schema, mas nenhuma rota/serviço aplicava a exigência "venda não pode ser
// concluída sem receita registrada" (Capítulo 4.5). Lançado DENTRO da transação,
// antes de qualquer baixa de estoque daquele item — o $transaction faz rollback
// completo, então nenhuma mutação de itens anteriores do carrinho sobrevive.
export class PrescriptionRequiredError extends Error {}
// Capítulo 11.2 — Ótica: GAP DE AUDITORIA FECHADO — `SalePaymentMethod.HEALTH_INSURANCE`
// exige cliente com convênio vinculado (`Client.healthInsurancePlanId`); sem isso não
// há como gerar depois a `AccountReceivable` consolidada por convênio.
export class HealthInsurancePlanRequiredError extends Error {}
// Capítulo 11.2 — Ótica: venda de lente de grau (`Product.opticsCategory = LENS`)
// exige cliente identificado (dono da O.S. de laboratório) e a receita óptica usada.
export class OpticalPrescriptionRequiredError extends Error {}
// Capítulo 11.2 — Ótica: produto `isConsignment` precisa ter `supplierId` definido —
// sem fornecedor não há a quem lançar a `AccountPayable` gerada na venda.
export class ConsignmentSupplierRequiredError extends Error {}

// Capítulo 11.5 — Papelaria/Presentes: kit escolar marcado como
// `Product.isKitComposition=true` precisa ter uma Recipe/RecipeItem cadastrada
// (PUT /products/:productId/recipe) descrevendo seus componentes antes de poder
// ser vendido.
export class KitCompositionMissingError extends Error {}

export async function closeSale(prisma: PrismaClient, input: CloseSaleServerInput) {
  // Idempotência em primeiro lugar, fora/antes de qualquer efeito colateral: o Service
  // Worker do PDV offline (Capítulo 8.3) pode reenviar a mesma venda várias vezes
  // durante uma reconexão instável — reenviar nunca deve criar uma segunda Sale. A
  // unicidade real do schema (tenantId_idempotencyKey) é composta, nunca um campo
  // globalmente único isolado — dois tenants podem gerar o mesmo UUID client-side por
  // coincidência estatística, e o isolamento multi-tenant não pode depender disso.
  const existingSale = await prisma.sale.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
  });
  if (existingSale) {
    return { sale: existingSale, fiscalDocument: null, isReplay: true as const };
  }

  try {
    return await executeCloseSaleTransaction(prisma, input);
  } catch (err) {
    // Replay concorrente: a checagem acima passou nas duas requisições, mas só uma commita.
    // P2002 (unique tenantId+idempotencyKey) ou P2034 (conflito de serialização) viram replay, nunca 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2034")) {
      const winner = await prisma.sale.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
      });
      if (winner) return { sale: winner, fiscalDocument: null, isReplay: true as const };
    }
    throw err;
  }
}

async function executeCloseSaleTransaction(prisma: PrismaClient, input: CloseSaleServerInput) {
  return prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: input.tenantId },
        select: { taxRegime: true, opticalAdditionalWarrantyDays: true },
      });
      // O caixa precisa pertencer ao tenant da sessão — nunca aceita um cashRegisterId alheio.
      // Não exige status OPEN: vendas do PDV offline (Capítulo 8.3) podem sincronizar
      // depois do fechamento do caixa em que foram realizadas.
      const register = await tx.cashRegister.findFirst({ where: { id: input.cashRegisterId, tenantId: input.tenantId }, select: { id: true } });
      if (!register) {
        throw new CashRegisterNotFoundError("Caixa não encontrado neste tenant.");
      }
      let totalAmount = new Prisma.Decimal(0);
      const saleItemsData: Prisma.SaleItemCreateManySaleInput[] = [];
      let totalTaxesApprox = new Prisma.Decimal(0);
      let legacyIcmsTotal = new Prisma.Decimal(0);
      let legacyPisCofinsTotal = new Prisma.Decimal(0);
      let ibsTotal = new Prisma.Decimal(0);
      let cbsTotal = new Prisma.Decimal(0);
      let selectiveTaxTotal = new Prisma.Decimal(0);
      // Capítulo 11.2 — Ótica: armações/lentes em consignação (`Product.isConsignment`)
      // não geram `AccountPayable` no recebimento (purchase-orders.routes.ts); a
      // obrigação só nasce AQUI, na baixa de estoque pela venda efetiva — uma
      // AccountPayable POR FORNECEDOR (nunca uma por item), pois um mesmo carrinho
      // pode conter armações consignadas de fornecedores diferentes.
      const consignmentBySupplier = new Map<string, { total: Prisma.Decimal; lines: string[] }>();
      // Capítulo 11.2 — Ótica: itens de lente de grau (`opticsCategory = LENS`) abrem
      // uma O.S. de laboratório (`WorkOrder.workOrderType = OPTICAL_LAB`) após o Sale
      // existir (precisa de `sale.id`) — coletado durante o loop, materializado depois.
      const opticalLabOrders: { productName: string; lensDeliveryType: "STOCK" | "CUSTOM"; opticalPrescriptionId: string }[] = [];

      for (const item of input.items) {
        const product = await tx.product.findFirstOrThrow({ where: { id: item.productId, tenantId: input.tenantId } });

        // Trava regulatória SNGPC/SNCR (Capítulo 4.5): produto de retenção obrigatória
        // (Lista B/tarja preta — Portaria 344/1998, RDC 1.000/2025) exige os dados
        // mínimos da receita no próprio payload da venda — sem isso a transação nunca
        // commita, e nenhum StockMovement/SaleItem deste carrinho é persistido.
        if (product.requiresPrescriptionRetention && !item.prescriptionData) {
          throw new PrescriptionRequiredError(
            `Produto ${product.name} exige retenção de receita (Lista B/tarja preta — Portaria 344/1998, RDC 1.000/2025). Informe prescriptionData (prescriptionType, patientDocument) para concluir a venda.`,
          );
        }

        // Capítulo 11.2 — Ótica: lente de grau exige cliente identificado (dono da O.S.
        // de laboratório) e a receita óptica usada — sem isso não há como abrir o
        // pedido de laboratório nem aplicar a numeração do Decreto 24.492/1934 depois.
        if (product.opticsCategory === "LENS") {
          if (!input.clientId) {
            throw new OpticalPrescriptionRequiredError(`Venda de lente de grau (${product.name}) exige cliente identificado.`);
          }
          if (!item.opticalPrescriptionId) {
            throw new OpticalPrescriptionRequiredError(`Venda de lente de grau (${product.name}) exige a receita óptica usada (opticalPrescriptionId).`);
          }
          const prescription = await tx.opticalPrescription.findFirst({
            where: { id: item.opticalPrescriptionId, tenantId: input.tenantId, clientId: input.clientId },
          });
          if (!prescription) {
            throw new OpticalPrescriptionRequiredError(`Receita óptica ${item.opticalPrescriptionId} não encontrada para este cliente.`);
          }
          opticalLabOrders.push({
            productName: product.name,
            lensDeliveryType: product.lensDeliveryType ?? "STOCK",
            opticalPrescriptionId: prescription.id,
          });
        }

        const lineGross = new Prisma.Decimal(item.unitPrice).times(item.quantity);

        // Capítulo 11.2 — Ótica: consignação — a venda efetiva é o gatilho real da
        // obrigação financeira com o fornecedor (a entrada em estoque, no recebimento
        // do pedido de compra, propositalmente NÃO cria `AccountPayable` para produtos
        // `isConsignment`). Acumulado por venda — uma AP por venda, nunca uma por item,
        // mesmo padrão já usado para o total normal da venda.
        if (product.isConsignment) {
          if (!product.supplierId) {
            throw new ConsignmentSupplierRequiredError(`Produto em consignação ${product.name} precisa ter um fornecedor cadastrado.`);
          }
          const entry = consignmentBySupplier.get(product.supplierId) ?? { total: new Prisma.Decimal(0), lines: [] as string[] };
          entry.total = entry.total.plus(lineGross);
          entry.lines.push(`${item.quantity}x ${product.name}`);
          consignmentBySupplier.set(product.supplierId, entry);
        }

        // 1. Dedução de estoque roteada pelo trackingType — jamais um decremento
        //    genérico único: cada tipo de rastreio tem sua própria regra de baixa.
        // Capítulo 11.5 — Papelaria/Presentes: kit escolar (`isKitComposition=true`)
        // reaproveita a mesma Recipe/RecipeItem da ficha técnica da padaria (Capítulo
        // 4.1) — a venda do kit NUNCA decrementa o `stockQuantity` do próprio kit (ele
        // não é um item fisicamente estocado em si, é uma composição vendida como
        // unidade), e sim de CADA componente individualmente, mantendo o estoque
        // granular correto. Um claim atômico por componente evita corrida de venda
        // simultânea do último componente em dois PDVs (mesmo padrão já usado para
        // variantes, acima/abaixo deste bloco).
        if (product.isKitComposition) {
          const recipe = await tx.recipe.findFirst({ where: { productId: product.id, tenantId: input.tenantId }, include: { items: true } });
          if (!recipe || recipe.items.length === 0) {
            throw new KitCompositionMissingError(
              `Produto kit ${product.name} está marcado como isKitComposition mas não tem ficha técnica (Recipe/RecipeItem) cadastrada.`,
            );
          }
          for (const recipeItem of recipe.items) {
            const componentQuantity = new Prisma.Decimal(recipeItem.quantityPerYield)
              .times(item.quantity)
              .dividedBy(new Prisma.Decimal(recipe.yieldQuantity));
            const claimed = await tx.product.updateMany({
              where: { id: recipeItem.ingredientId, tenantId: input.tenantId, stockQuantity: { gte: componentQuantity } },
              data: { stockQuantity: { decrement: componentQuantity } },
            });
            if (claimed.count === 0) {
              throw new InsufficientStockError(`Estoque insuficiente de um componente do kit ${product.name} para concluir a venda.`);
            }
            await tx.stockMovement.create({
              data: {
                tenantId: input.tenantId,
                productId: recipeItem.ingredientId,
                type: "SALE_OUT",
                quantity: componentQuantity.negated(),
                referenceId: input.idempotencyKey,
              },
            });
          }
        } else if (product.trackingType === "BATCH") {
          // Núcleo direto (...WithinTx), nunca o wrapper deductStockFefo — já estamos
          // dentro da transação `tx` desta própria função; abrir uma segunda transação
          // aninhada aqui seria o bug de nesting corrigido no Capítulo 6.2.
          await deductStockFefoWithinTx(tx, {
            tenantId: input.tenantId,
            productId: product.id,
            quantity: new Prisma.Decimal(item.quantity),
            saleItemId: input.idempotencyKey,
          });
        } else if (product.trackingType === "SERIAL") {
          if (!item.serialNumber) {
            throw new SerialNotFoundError(`Venda do produto ${product.name} exige a leitura do número de série/IMEI.`);
          }
          const serial = await tx.productSerial.findUnique({
            where: { tenantId_serialNumber: { tenantId: input.tenantId, serialNumber: item.serialNumber } },
          });
          if (!serial || serial.productId !== product.id) {
            throw new SerialNotFoundError(`Serial ${item.serialNumber} não encontrado no estoque deste produto.`);
          }
          if (serial.status === "SOLD") {
            throw new SerialNotReadyForSaleError(`Serial ${item.serialNumber} já consta como vendido.`);
          }
          // Bloqueia explicitamente a venda de uma unidade cujo IMEI ainda não foi
          // conferido fisicamente na entrada da NF-e (Capítulo 6.5) — nunca vende
          // "estoque fantasma" criado apenas pelo incremento numérico da quantidade.
          if (serial.status === "PENDING_SERIAL_ENTRY") {
            throw new SerialNotReadyForSaleError(
              `Serial ${item.serialNumber} ainda está pendente de conferência física de IMEI — não pode ser vendido.`,
            );
          }
          await tx.productSerial.update({ where: { id: serial.id }, data: { status: "SOLD" } });
          await tx.product.update({ where: { id: product.id }, data: { stockQuantity: { decrement: 1 } } });
        } else {
          // NONE: baixa direta, sem necessidade de lock por lote/série.
          if (product.trackingType === "VARIANT") {
            // Correção de auditoria (Capítulo 4.6 — grades de variação): antes desta
            // correção, um produto VARIANT só decrementava o saldo agregado do
            // produto-pai e `SaleItem.productVariantId` nunca era gravado — o saldo por
            // variante (`ProductVariant.stockQuantity`) divergia do que realmente saiu
            // pelo PDV, e relatórios/estoque por variante (Capítulo 4.6/11.4) ficavam
            // incorretos desde a primeira venda.
            if (!item.productVariantId) {
              throw new VariantRequiredError(`Venda do produto ${product.name} exige a seleção da variante (cor/tamanho).`);
            }
            const variant = await tx.productVariant.findFirst({ where: { id: item.productVariantId, tenantId: input.tenantId, productId: product.id } });
            if (!variant) {
              throw new VariantNotFoundError(`Variante ${item.productVariantId} não encontrada para o produto ${product.name}.`);
            }
            // Claim atômico (mesmo padrão do ajuste de estoque de variante): nunca um
            // findUnique seguido de update, que abriria corrida de venda duplicada da
            // última unidade em dois PDVs simultâneos.
            const claimed = await tx.productVariant.updateMany({
              where: { id: variant.id, tenantId: input.tenantId, stockQuantity: { gte: new Prisma.Decimal(item.quantity) } },
              data: { stockQuantity: { decrement: item.quantity } },
            });
            if (claimed.count === 0) {
              throw new InsufficientVariantStockError(`Estoque insuficiente para a variante ${variant.axisValue} do produto ${product.name}.`);
            }
          }
          await tx.product.update({ where: { id: product.id }, data: { stockQuantity: { decrement: item.quantity } } });
        }

        // BATCH já gravou um StockMovement por lote dentro de deductStockFefoWithinTx,
        // e o kit (isKitComposition) já gravou um StockMovement por componente acima —
        // criar outro aqui duplicaria a saída no ledger de estoque (e, no caso do kit,
        // apontaria uma saída de stockQuantity do próprio kit que nunca foi decrementado).
        if (product.trackingType !== "BATCH" && !product.isKitComposition) {
          await tx.stockMovement.create({
            data: {
              tenantId: input.tenantId,
              productId: product.id,
              type: "SALE_OUT",
              quantity: new Prisma.Decimal(item.quantity).negated(),
              referenceId: input.idempotencyKey,
            },
          });
        }

        // 2. Tributação real por item — nunca um percentual fixo aplicado ao total da
        //    venda, pois cada produto pode ter NCM/regra fiscal diferente (Capítulo 21).
        const taxResult = await calculateTax(tx, {
          tenantId: input.tenantId,
          ncm: product.ncm ?? "00000000",
          uf: product.originUf ?? "SP",
          nicheCode: product.nicheCode ?? "MARKET",
          grossAmount: lineGross,
        });

        legacyIcmsTotal = legacyIcmsTotal.plus(taxResult.legacyIcmsAmount);
        legacyPisCofinsTotal = legacyPisCofinsTotal.plus(taxResult.legacyPisCofinsAmount);
        ibsTotal = ibsTotal.plus(taxResult.ibsAmount);
        cbsTotal = cbsTotal.plus(taxResult.cbsAmount);
        selectiveTaxTotal = selectiveTaxTotal.plus(taxResult.selectiveTaxAmount);
        totalTaxesApprox = totalTaxesApprox
          .plus(taxResult.legacyIcmsAmount)
          .plus(taxResult.legacyPisCofinsAmount)
          .plus(taxResult.ibsAmount)
          .plus(taxResult.cbsAmount)
          .plus(taxResult.selectiveTaxAmount);

        totalAmount = totalAmount.plus(lineGross);
        // Capítulo 11.2 — Ótica: garantia legal CDC (90 dias, art. 26, II) + garantia
        // contratual adicional configurável pela loja — somadas, congeladas no momento
        // da venda, para qualquer item de armação ou lente (nunca para outros nichos).
        const warrantyExpiresAt = product.opticsCategory
          ? addCalendarDays(new Date(), 90 + (tenant.opticalAdditionalWarrantyDays ?? 0))
          : null;
        saleItemsData.push({
          tenantId: input.tenantId,
          productId: product.id,
          ...(product.trackingType === "VARIANT" && item.productVariantId ? { productVariantId: item.productVariantId } : {}),
          quantity: new Prisma.Decimal(item.quantity),
          unitPrice: new Prisma.Decimal(item.unitPrice),
          totalPrice: lineGross,
          ...(warrantyExpiresAt ? { warrantyExpiresAt } : {}),
        });
      }

      const changeDue =
        input.paymentMethod === "CASH" && input.amountTendered
          ? Prisma.Decimal.max(0, new Prisma.Decimal(input.amountTendered).minus(totalAmount))
          : new Prisma.Decimal(0);

      // Capítulo 4.6 — Varejo Geral (Crediário/Fiado): toda venda STORE_CREDIT exige
      // clientId (debita o saldo disponível DESSE cliente) e precisa caber dentro do
      // limite ainda disponível (creditLimit - creditBalanceUsed). `creditLimit` é lido
      // aqui dentro da MESMA transação Serializable da função (ver `$transaction` no
      // fim do arquivo): se outra venda STORE_CREDIT concorrente alterar
      // `creditBalanceUsed` deste cliente entre esta leitura e o commit, o Postgres
      // rejeita uma das duas com conflito de serialização (P2034), que `closeSale()`
      // já trata como replay-safe/retry — nunca dependemos de um `findUnique` seguido
      // de `update` desacoplado, que abriria corrida real de duas vendas fiadas
      // simultâneas estourando o limite do mesmo cliente. O `updateMany` abaixo
      // re-confirma a condição no próprio WHERE como segunda camada de proteção
      // (mesmo padrão atômico de `loyalty.routes.ts` redeemLoyaltyPoints/adjustSchema).
      if (input.paymentMethod === "STORE_CREDIT") {
        if (!input.clientId) {
          throw new ClientRequiredForStoreCreditError("Venda a prazo (STORE_CREDIT) exige a seleção do cliente.");
        }
        const client = await tx.client.findFirst({
          where: { id: input.clientId, tenantId: input.tenantId },
          select: { creditLimit: true },
        });
        const availableLimit = (client?.creditLimit ?? new Prisma.Decimal(0)).minus(totalAmount);
        const claimedCredit = await tx.client.updateMany({
          where: {
            id: input.clientId,
            tenantId: input.tenantId,
            creditBalanceUsed: { lte: availableLimit },
          },
          data: { creditBalanceUsed: { increment: totalAmount } },
        });
        if (claimedCredit.count === 0) {
          throw new CreditLimitExceededError("Limite de crediário do cliente insuficiente para esta venda a prazo.");
        }
      }

      // Capítulo 11.2 — Ótica: venda por convênio exige cliente com
      // `healthInsurancePlanId` vinculado — a venda em si segue normal no PDV (não
      // paga nada agora); o recebimento efetivo vira uma AccountReceivable
      // CONSOLIDADA por convênio/competência (ver health-insurance-billing.routes.ts),
      // nunca uma por venda individual.
      let healthInsurancePlanId: string | null = null;
      if (input.paymentMethod === "HEALTH_INSURANCE") {
        if (!input.clientId) {
          throw new HealthInsurancePlanRequiredError("Venda por convênio exige a seleção do cliente.");
        }
        const client = await tx.client.findFirst({
          where: { id: input.clientId, tenantId: input.tenantId },
          select: { healthInsurancePlanId: true },
        });
        if (!client?.healthInsurancePlanId) {
          throw new HealthInsurancePlanRequiredError("Cliente não possui convênio/plano de saúde vinculado.");
        }
        healthInsurancePlanId = client.healthInsurancePlanId;
      }

      const sale = await tx.sale.create({
        data: {
          tenantId: input.tenantId,
          ...(input.clientId ? { clientId: input.clientId } : {}),
          cashierId: input.cashierId,
          idempotencyKey: input.idempotencyKey,
          cashRegisterId: input.cashRegisterId,
          paymentMethod: input.paymentMethod,
          status: "PAID",
          totalAmount,
          ...(healthInsurancePlanId ? { healthInsurancePlanId } : {}),
        },
      });

      // Itens criados individualmente (não createMany) propositalmente: precisamos do
      // `id` real de cada SaleItem assim que criado para gravar, ainda dentro desta
      // mesma transação, o `PrescriptionRecord` correspondente (Capítulo 4.5) — sem
      // isso a trava regulatória acima não teria como persistir a receita retida
      // vinculada ao item de venda (`PrescriptionRecord.saleItemId` é FK obrigatória
      // e @unique, exigindo um SaleItem já existente). `saleItemsData` e
      // `input.items` mantêm o mesmo índice: o loop anterior faz exatamente um
      // `push` por item de `input.items`, nunca pulando nenhum.
      for (let i = 0; i < saleItemsData.length; i++) {
        const createdItem = await tx.saleItem.create({ data: { ...saleItemsData[i], saleId: sale.id } });
        const prescriptionData = input.items[i]?.prescriptionData;
        if (prescriptionData) {
          await tx.prescriptionRecord.create({
            data: {
              tenantId: input.tenantId,
              saleItemId: createdItem.id,
              prescriptionType: prescriptionData.prescriptionType,
              patientDocument: prescriptionData.patientDocument,
              electronicPrescriptionNumber: prescriptionData.electronicPrescriptionNumber ?? null,
              retainedDocumentStorageKey: prescriptionData.retainedDocumentStorageKey ?? null,
              validatedByUserId: input.cashierId,
            },
          });
        }
      }

      // Capítulo 4.1.1 — crédito automático de pontos de fidelidade (EARN), na MESMA
      // transação do fechamento da venda. Pendência documentada em loyalty.routes.ts
      // fechada aqui; REDEEM na venda permanece pendente (sem campo correspondente
      // ainda no PDV) e está documentado como pendência explícita no README do módulo.
      await accrueLoyaltyPoints(tx, {
        tenantId: input.tenantId,
        clientId: input.clientId ?? null,
        saleId: sale.id,
        totalAmount,
      });

      // Capítulo 11.2 — Ótica: uma AccountPayable por FORNECEDOR de item consignado
      // vendido nesta venda (status PENDING, vencimento imediato — o lojista já deve
      // o repasse ao fornecedor assim que a peça sai do estoque pela venda efetiva).
      for (const [supplierId, entry] of consignmentBySupplier.entries()) {
        await tx.accountPayable.create({
          data: {
            tenantId: input.tenantId,
            supplierId,
            description: `Consignação vendida (venda ${sale.id}): ${entry.lines.join(", ")}`,
            amount: entry.total,
            dueDate: new Date(),
            saleId: sale.id,
          },
        });
      }

      // Capítulo 11.2 — Ótica: abre a O.S. de laboratório óptico para cada lente de
      // grau vendida, com prazo estimado por `lensDeliveryType` (estoque = 1-2 dias
      // úteis; personalizada = 3-10+ dias úteis). A notificação de READY ao cliente é
      // disparada pelo endpoint dedicado de transição de status (optical-lab-work-
      // orders.routes.ts — `work-orders.routes.ts` está sob restrição de edição).
      for (const labOrder of opticalLabOrders) {
        const estimatedReadyAt = addBusinessDays(new Date(), labOrder.lensDeliveryType === "CUSTOM" ? 10 : 2);
        await tx.workOrder.create({
          data: {
            tenantId: input.tenantId,
            clientId: input.clientId!,
            equipmentDescription: `Lente de grau — ${labOrder.productName}`,
            reportedIssue: "Confecção de lente de grau a partir de receita óptica registrada.",
            workOrderType: "OPTICAL_LAB",
            estimatedReadyAt,
            opticalPrescriptionId: labOrder.opticalPrescriptionId,
            saleId: sale.id,
          },
        });
      }

      await tx.payment.create({
        data: {
          tenantId: input.tenantId,
          saleId: sale.id,
          method: input.paymentMethod,
          status: "CONFIRMED",
          amount: totalAmount,
          changeDue,
          idempotencyKey: `${input.idempotencyKey}:payment`,
        },
      });

      // 3. FiscalDocument nasce PENDING nesta mesma transação — nunca criado depois, de
      //    forma desacoplada, o que abriria uma janela em que a venda existe sem nenhum
      //    documento fiscal correspondente ainda sendo rastreado.
      const fiscalDocument = await tx.fiscalDocument.create({
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
          totalTaxesApprox,
          taxRegimeSnapshot: tenant.taxRegime,
          // Resolvido pela data real da venda, nunca por uma escolha do usuário
          // (Capítulo 21.15) — gravado de forma imutável junto ao documento emitido.
          faseReformaTributaria: resolveTaxReformPhase(new Date()),
        },
      });

      return { sale, fiscalDocument, changeDue, isReplay: false as const };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

// 4. Fora da transação (commit já confirmado): enfileira a emissão real via Focus NFe
//    (Capítulo 20.3) em BullMQ — nunca síncrono dentro da transação de banco, para não
//    segurar o lock de estoque esperando resposta de rede externa.
export async function closeSaleAndEmitFiscalDocument(prisma: PrismaClient, input: CloseSaleServerInput) {
  const result = await closeSale(prisma, input);
  if (!result.isReplay && result.fiscalDocument) {
    await enqueueFiscalEmission({ fiscalDocumentId: result.fiscalDocument.id, tenantId: input.tenantId });
  }
  return result;
}
