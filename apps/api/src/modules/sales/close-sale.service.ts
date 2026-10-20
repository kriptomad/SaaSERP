// apps/api/src/modules/sales/close-sale.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.6 — Fechamento Transacional da Venda, o
// orquestrador real por trás de POST /api/sales (Capítulo 9.5). Único ponto do sistema
// que transiciona uma venda de "recebida" para "paga e fiscalmente registrada",
// unificando: (1) idempotência, (2) dedução de estoque roteada pelo trackingType do
// produto, (3) cálculo tributário real via TaxEngine, e (4) enfileiramento da emissão
// fiscal (fora da transação de banco).
import { Prisma, TenantScopedPrismaClient } from "@filitech/db";
import { calculateFullTax } from "../fiscal/tax-engine.service";
import { resolveTaxReformPhase } from "../fiscal/tax-reform-phase.service";
import { deductStockFefoWithinTx } from "../../services/stock/deduct-stock-fefo.service";
import { InsufficientStockError } from "../../services/stock/deduct-stock-fefo.service";
import { enqueueFiscalEmission } from "../fiscal/queues/fiscal-emission.queue";
import { accrueLoyaltyPoints } from "../loyalty/accrue-loyalty-points.service";
import { dispatchWebhookEvent } from "../../lib/webhook-dispatch";
import { createModuleLogger } from "../../lib/logger";

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

// CORREÇÃO DE AUDITORIA (fa-sale-quantity-fraction-unvalidated): antes, `item.quantity`
// era usado direto na baixa de estoque (lote/variante/produto) sem validar se o
// produto realmente permite venda fracionada (`Product.isWeighted`/`saleUnit`) nem se
// a quantidade respeita a escala decimal das colunas de estoque (`Decimal(12,3)`).
// Isso permitia, por exemplo, vender "0.5" unidade de um produto só-unidade (saleUnit
// UNIT, isWeighted=false — ex.: uma lata de refrigerante) ou uma quantidade com mais
// casas decimais do que o banco suporta (arredondado silenciosamente pelo Postgres,
// divergindo do que o caixa viu na tela). Exportada para ser reaproveitada como
// validação prévia (antes de abrir a transação) em sales.routes.ts — a validação
// definitiva, que não pode ser contornada, é sempre a execução abaixo dentro da
// transação de fechamento, com o produto lido do próprio banco.
export function assertValidSaleQuantity(
  product: { name: string; saleUnit: string; isWeighted: boolean; trackingType: string },
  quantity: number,
): void {
  // Produto rastreado por número de série representa uma unidade física discreta —
  // nunca "0.5 serial". Each SaleItem corresponde a exatamente 1 serial lido.
  if (product.trackingType === "SERIAL" && quantity !== 1) {
    throw new InvalidSaleQuantityError(
      `Produto ${product.name} é rastreado por número de série/IMEI — cada item da venda deve ter quantidade exatamente 1 (um serial por linha).`,
    );
  }

  const allowsFractionalSale = product.isWeighted || product.saleUnit !== "UNIT";
  if (!allowsFractionalSale && !Number.isInteger(quantity)) {
    throw new InvalidSaleQuantityError(
      `Produto ${product.name} é vendido apenas em unidades inteiras (saleUnit=UNIT, isWeighted=false) — quantidade ${quantity} é inválida.`,
    );
  }

  // Colunas de saldo (`Product.stockQuantity`/`ProductVariant.stockQuantity`) são
  // `Decimal(12,3)` — mais de 3 casas decimais seria truncado silenciosamente pelo
  // banco, divergindo do valor exibido/confirmado na tela do PDV.
  const decimalPlaces = (Math.abs(quantity).toString().split(".")[1] ?? "").length;
  if (decimalPlaces > 3) {
    throw new InvalidSaleQuantityError(
      `Quantidade ${quantity} do produto ${product.name} excede a precisão suportada pelo estoque (máximo 3 casas decimais).`,
    );
  }
}

export interface CloseSaleServerInput {
  tenantId: string;
  idempotencyKey: string;
  cashRegisterId: string;
  cashierId: string;
  // fa-w4-obs-no-request-id: id da requisição HTTP original (ver sales.routes.ts),
  // propagado apenas para o job de emissão fiscal enfileirado abaixo em
  // `closeSaleAndEmitFiscalDocument` — permite correlacionar os logs do worker
  // fiscal-emission.worker.ts de volta à requisição de fechamento de venda que o
  // originou. Nunca usado dentro da transação de negócio em si.
  requestId?: string;
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
  // GAP DE AUDITORIA FECHADO (Rodada 6 — Pagamento Dividido/Split, Capítulo 9): o
  // schema já tinha `Payment[]` 1-N em `Sale` desde a primeira versão, mas esta
  // função SEMPRE criava exatamente 1 `Payment` — nunca existia forma real de
  // dividir uma venda entre dois ou mais métodos (ex.: metade PIX, metade cartão de
  // crédito), um pedido frequentíssimo de PDV físico real. Exatamente um dos dois
  // grupos abaixo deve ser informado — nunca ambos, nunca nenhum (validado logo no
  // início da transação): `paymentMethod`/`amountTendered` (venda de método único,
  // comportamento 100% preservado) OU `payments` (split real, 2+ métodos).
  // STORE_CREDIT/HEALTH_INSURANCE nunca podem aparecer dentro de um `payments[]` com
  // mais de uma linha — cada um já alimenta um subsistema de cobrança consolidada
  // próprio (crediário do cliente / fatura de convênio) desenhado para o valor CHEIO
  // da venda, nunca uma fração dela.
  paymentMethod?: "CASH" | "DEBIT_CARD" | "CREDIT_CARD" | "PIX" | "BOLETO" | "STORE_CREDIT" | "HEALTH_INSURANCE";
  amountTendered?: number;
  payments?: {
    method: "CASH" | "DEBIT_CARD" | "CREDIT_CARD" | "PIX" | "BOLETO" | "STORE_CREDIT" | "HEALTH_INSURANCE";
    amount: number;
    amountTendered?: number;
  }[];
}

export class SerialNotReadyForSaleError extends Error {}
export class SerialNotFoundError extends Error {}
// CORREÇÃO DE AUDITORIA (fa-serial-sale-not-atomic-claim): o claim de serial
// concorrente (dois PDVs lendo o mesmo serial IN_STOCK e ambos tentando vendê-lo)
// agora falha com este erro em vez de permitir dupla venda silenciosa.
export class SerialAlreadyClaimedError extends Error {}
export class CashRegisterNotFoundError extends Error {}
export class VariantRequiredError extends Error {}
export class VariantNotFoundError extends Error {}
export class InsufficientVariantStockError extends Error {}
// CORREÇÃO DE AUDITORIA (fa-sale-quantity-fraction-unvalidated): quantidade do item
// incompatível com a regra de fracionamento do produto (ex.: produto vendido só em
// unidade inteira recebendo quantidade fracionada) ou com a escala decimal suportada
// pelas colunas de estoque (`Decimal(12,3)`).
export class InvalidSaleQuantityError extends Error {}
// Capítulo 4.6 — Varejo Geral (Crediário/Fiado): GAP DE AUDITORIA ENCONTRADO E
// CORRIGIDO. `paymentMethod: STORE_CREDIT` já era aceito pelo tipo, mas nenhuma
// validação contra `Client.creditLimit`/`creditBalanceUsed` existia — a regra de
// negócio central do nicho (bloqueio automático de crediário) simplesmente não
// existia, era só um valor de enum aceito sem lógica alguma por trás.
export class ClientRequiredForStoreCreditError extends Error {}
export class CreditLimitExceededError extends Error {}
// Pagamento Dividido/Split (Capítulo 9) — validação de forma/payload de `payments[]`:
// soma não bate com o total da venda, nem `paymentMethod` nem `payments` informado
// (ou os dois ao mesmo tempo), ou método de cobrança consolidada (STORE_CREDIT/
// HEALTH_INSURANCE) usado junto de outro método na mesma venda.
export class SplitPaymentValidationError extends Error {}
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

// CORREÇÃO DE AUDITORIA (mega-audit rodada 7, falha CRÍTICA de integridade financeira):
// `item.unitPrice` vinha do CLIENTE (payload do PDV — inclusive do carrinho offline,
// Capítulo 8.3) e era usado DIRETO no cálculo de `lineGross`/`SaleItem.unitPrice`, sem
// qualquer verificação contra o preço real cadastrado no servidor (`Product.unitPrice`/
// `wholesalePrice`/`resalePrice`/`ProductVariant.priceOverride` — mesma cascata de
// `product-pricing.routes.ts`). Um caixa mal-intencionado (ou um cache offline
// desatualizado/corrompido) podia fechar qualquer venda pelo preço que quisesse, sem
// nenhuma trava — ex.: vender um produto de R$ 5.000 por R$ 0,01. Lançado quando o
// preço enviado diverge do preço canônico resolvido no servidor.
export class PriceMismatchError extends Error {}

export async function closeSale(prisma: TenantScopedPrismaClient, input: CloseSaleServerInput) {
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
    // CORREÇÃO DE AUDITORIA (mega-audit rodada 7): antes retornava `fiscalDocument:
    // null` aqui, fazendo `closeSaleAndEmitFiscalDocument` nunca saber que havia um
    // documento fiscal PENDING para retentar o enqueue num replay — precisa buscar o
    // documento real para o chamador poder decidir se vale reenfileirar a emissão.
    const existingFiscalDocument = await prisma.fiscalDocument.findFirst({ where: { saleId: existingSale.id } });
    return { sale: existingSale, fiscalDocument: existingFiscalDocument, isReplay: true as const };
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
      if (winner) {
        const winnerFiscalDocument = await prisma.fiscalDocument.findFirst({ where: { saleId: winner.id } });
        return { sale: winner, fiscalDocument: winnerFiscalDocument, isReplay: true as const };
      }
    }
    throw err;
  }
}

async function executeCloseSaleTransaction(prisma: TenantScopedPrismaClient, input: CloseSaleServerInput) {
  return prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: input.tenantId },
        select: { taxRegime: true, opticalAdditionalWarrantyDays: true, uf: true },
      });
      // Capítulo 2.6/6.6 (r5-gatekeeper-global) — FISCAL_NFCE é módulo pago
      // (MODULE_CATALOG, R$49,90/mês): a venda em si nunca é bloqueada por falta
      // desse módulo, mas a emissão real via Focus NFe só é enfileirada se o
      // tenant contratou. Sem o módulo, o FiscalDocument nasce NOT_CONTRACTED —
      // a tributação ainda é calculada e persistida (devido ao fisco independente
      // de o lojista ter contratado a automação de emissão).
      const fiscalModule = await tx.tenantModule.findFirst({
        where: { tenantId: input.tenantId, moduleCode: "FISCAL_NFCE", active: true },
        select: { id: true },
      });
      const fiscalNfceContracted = Boolean(fiscalModule);
      // Capítulo 21.10 — DIFAL: UF de destino e contribuinte de ICMS vêm do cliente
      // vinculado à venda (quando houver); venda sem cliente identificado (balcão
      // anônimo) nunca cruza fronteira estadual de fato, então cai para a UF do
      // próprio tenant (destino = origem, DIFAL inaplicável por definição).
      const saleClient = input.clientId
        ? await tx.client.findFirst({ where: { id: input.clientId, tenantId: input.tenantId }, select: { uf: true, icmsContributor: true, isReseller: true } })
        : null;
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
      let difalTotal = new Prisma.Decimal(0);
      let monofasicoSegregatedTotal = new Prisma.Decimal(0);
      let usedVehicleIcmsTotal = new Prisma.Decimal(0);
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
      // Capítulo 4.3 — Adega/Bebidas: vendas de produto com `isReturnableContainer=true`
      // geram automaticamente um lançamento BORROWED na conta-corrente de cascos
      // (ver liquor-ledger.routes.ts) — coletado durante o loop (ainda sem `sale.id`)
      // e materializado depois, mesmo padrão de `opticalLabOrders` acima.
      const returnableContainerEntries: { productId: string; quantity: number }[] = [];
      // GAP DE AUDITORIA FECHADO (Rodada 6): `ProductSerial` não tinha nenhum vínculo
      // com a venda que o consumiu — o estorno (refund-sale.service.ts) não tinha
      // como saber QUAL serial/IMEI devolver para IN_STOCK, só o agregado
      // `Product.stockQuantity`. Coletado durante o loop (ainda sem `sale.id`) e
      // vinculado depois, mesmo padrão de `opticalLabOrders`/`returnableContainerEntries`.
      const soldSerialIds: string[] = [];

      // CORREÇÃO DE AUDITORIA (fa-w5-perf-pdv-item-roundtrips): antes, o loop abaixo
      // disparava de 3 a 5 queries sequenciais POR ITEM (produto, variante, receita/
      // recipe, serial, receita óptica) — com o cart aberto dentro da transação
      // Serializable, um carrinho de 30 itens segurava o lock de estoque por 100+
      // round-trips sequenciais ao banco. Pré-busca em lote (ainda DENTRO da mesma
      // transação, portanto com a MESMA consistência de leitura Serializable de
      // antes) de tudo que é referenciável por id/chave conhecida ANTES do loop,
      // materializado em Maps — o loop abaixo passa a resolver cada entidade por
      // lookup em memória (O(1)) em vez de uma query nova. Toda semântica de
      // "não encontrado" é preservada abaixo, item a item, incluindo o fallback que
      // replica EXATAMENTE o erro do antigo `findFirstOrThrow` do Prisma quando o
      // produto realmente não existe (caminho raro, fora do hot path).
      const uniqueProductIds = Array.from(new Set(input.items.map((item) => item.productId)));
      const products = uniqueProductIds.length > 0
        ? await tx.product.findMany({ where: { id: { in: uniqueProductIds }, tenantId: input.tenantId } })
        : [];
      const productById = new Map(products.map((p) => [p.id, p]));

      const uniqueVariantIds = Array.from(
        new Set(input.items.map((item) => item.productVariantId).filter((id): id is string => Boolean(id))),
      );
      const variants = uniqueVariantIds.length > 0
        ? await tx.productVariant.findMany({ where: { id: { in: uniqueVariantIds }, tenantId: input.tenantId } })
        : [];
      const variantById = new Map(variants.map((v) => [v.id, v]));

      // Uma linha por produto no máximo (`Recipe.productId` é único) — cobre tanto o
      // uso de kit (`isKitComposition`, precisa de `items`) quanto a checagem de
      // produção própria (`isOwnProduction`, só precisa de existência) mais abaixo,
      // com o mesmo Map (o `include: { items: true }` é um superset do antigo
      // `select: { id: true }` usado na segunda ocorrência — nunca uma divergência de
      // dado, só um fetch levemente mais largo e já em lote).
      const recipes = uniqueProductIds.length > 0
        ? await tx.recipe.findMany({ where: { productId: { in: uniqueProductIds }, tenantId: input.tenantId }, include: { items: true } })
        : [];
      const recipeByProductId = new Map(recipes.map((r) => [r.productId, r]));

      const uniqueSerialNumbers = Array.from(
        new Set(input.items.map((item) => item.serialNumber).filter((s): s is string => Boolean(s))),
      );
      const serials = uniqueSerialNumbers.length > 0
        ? await tx.productSerial.findMany({ where: { tenantId: input.tenantId, serialNumber: { in: uniqueSerialNumbers } } })
        : [];
      const serialByNumber = new Map(serials.map((s) => [s.serialNumber, s]));
      // Guarda, em memória, quais serials já foram reclamados por um item ANTERIOR
      // do mesmo carrinho (dentro deste mesmo loop) — replica o comportamento antigo
      // de "query fresca por item", que detectaria o status já SOLD de um serial
      // duplicado no mesmo carrinho (erro amigável) antes mesmo do `updateMany`
      // atômico de claim (que também protegeria, mas com uma mensagem de erro
      // diferente/menos específica).
      const claimedSerialIdsInThisSale = new Set<string>();

      const uniqueOpticalPrescriptionIds = Array.from(
        new Set(input.items.map((item) => item.opticalPrescriptionId).filter((id): id is string => Boolean(id))),
      );
      const opticalPrescriptions = uniqueOpticalPrescriptionIds.length > 0 && input.clientId
        ? await tx.opticalPrescription.findMany({
            where: { id: { in: uniqueOpticalPrescriptionIds }, tenantId: input.tenantId, clientId: input.clientId },
          })
        : [];
      const opticalPrescriptionById = new Map(opticalPrescriptions.map((p) => [p.id, p]));

      for (const item of input.items) {
        // Caminho rápido: produto já pré-buscado em lote acima. Caminho raro (miss no
        // Map — productId realmente inválido/inexistente neste tenant): cai de volta
        // para o `findFirstOrThrow` original, que lança o MESMO erro Prisma
        // (PrismaClientKnownRequestError P2025) que o código lançava antes desta
        // otimização, preservando o comportamento de erro byte a byte.
        const product = productById.get(item.productId)
          ?? (await tx.product.findFirstOrThrow({ where: { id: item.productId, tenantId: input.tenantId } }));

        // CORREÇÃO DE AUDITORIA (fa-sale-quantity-fraction-unvalidated): revalida a
        // quantidade do item contra a regra de fracionamento/escala do produto lido
        // agora do próprio banco (nunca confia apenas na validação prévia da rota,
        // que pode estar olhando um snapshot do produto já desatualizado).
        assertValidSaleQuantity(product, item.quantity);

        // CORREÇÃO DE AUDITORIA (mega-audit rodada 7): resolve o preço canônico no
        // SERVIDOR — nunca confia no `item.unitPrice` enviado pelo cliente (PDV online
        // ou fila offline, Capítulo 8.3) — e rejeita a venda se ele divergir (tolerância
        // de 1 centavo para arredondamento de Decimal). Mesma cascata de prioridade de
        // `product-pricing.routes.ts`: 1) `ProductVariant.priceOverride`, 2) Preço
        // Revenda (`Client.isReseller` + `Product.resalePrice`), 3) Preço Atacado
        // (`quantity >= wholesaleMinQty` + `wholesalePrice`), 4) Preço Unidade.
        let expectedUnitPrice: Prisma.Decimal;
        if (item.productVariantId) {
          const variantForPricing = variantById.get(item.productVariantId);
          const priceOverride = variantForPricing && variantForPricing.productId === product.id ? variantForPricing.priceOverride : null;
          expectedUnitPrice = priceOverride ?? product.unitPrice;
        } else if (saleClient?.isReseller && product.resalePrice !== null) {
          expectedUnitPrice = product.resalePrice;
        } else if (product.wholesaleMinQty !== null && product.wholesalePrice !== null && item.quantity >= product.wholesaleMinQty) {
          expectedUnitPrice = product.wholesalePrice;
        } else {
          expectedUnitPrice = product.unitPrice;
        }
        if (expectedUnitPrice.minus(new Prisma.Decimal(item.unitPrice)).abs().greaterThan("0.01")) {
          throw new PriceMismatchError(
            `Preço divergente para ${product.name}: enviado R$ ${item.unitPrice.toFixed(2)}, preço atual no servidor é R$ ${expectedUnitPrice.toFixed(2)}. Atualize o catálogo e tente novamente.`,
          );
        }

        // Trava regulatória SNGPC/SNCR (Capítulo 4.5): produto de retenção obrigatória
        // (Lista B/tarja preta — Portaria 344/1998, RDC 1.000/2025) OU classificado como
        // substância controlada (escrituração SNGPC) exige os dados mínimos da receita
        // no próprio payload da venda — sem isso a transação nunca commita, e nenhum
        // StockMovement/SaleItem deste carrinho é persistido. GAP DE AUDITORIA FECHADO:
        // antes só `requiresPrescriptionRetention` era checado; `isControlledSubstance`
        // (flag independente no schema — um produto pode ser controlado sem estar na
        // Lista B de retenção obrigatória, ex. alguns antimicrobianos RDC 20/2011) não
        // disparava trava alguma, permitindo dispensação de controlado sem receita.
        if ((product.requiresPrescriptionRetention || product.isControlledSubstance) && !item.prescriptionData) {
          throw new PrescriptionRequiredError(
            `Produto ${product.name} exige retenção de receita (Lista B/tarja preta/substância controlada — Portaria 344/1998, RDC 1.000/2025). Informe prescriptionData (prescriptionType, patientDocument) para concluir a venda.`,
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
          const prescription = opticalPrescriptionById.get(item.opticalPrescriptionId);
          if (!prescription) {
            throw new OpticalPrescriptionRequiredError(`Receita óptica ${item.opticalPrescriptionId} não encontrada para este cliente.`);
          }
          opticalLabOrders.push({
            productName: product.name,
            lensDeliveryType: product.lensDeliveryType ?? "STOCK",
            opticalPrescriptionId: prescription.id,
          });
        }

        if (product.isReturnableContainer && input.clientId) {
          returnableContainerEntries.push({ productId: product.id, quantity: item.quantity });
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
          const recipe = recipeByProductId.get(product.id);
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
          const serial = serialByNumber.get(item.serialNumber);
          if (!serial || serial.productId !== product.id) {
            throw new SerialNotFoundError(`Serial ${item.serialNumber} não encontrado no estoque deste produto.`);
          }
          if (serial.status === "SOLD" || claimedSerialIdsInThisSale.has(serial.id)) {
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
          // CORREÇÃO DE AUDITORIA (fa-serial-sale-not-atomic-claim): o `findUnique`
          // acima é só uma leitura para mensagens de erro amigáveis — o claim real do
          // serial é este `updateMany` condicional (`WHERE id=? AND status='IN_STOCK'`),
          // nunca um `update()` direto baseado no status já lido. Duas vendas
          // concorrentes do mesmo serial (dois PDVs lendo "IN_STOCK" ao mesmo tempo)
          // só deixam UMA ganhar a corrida — a segunda encontra `count !== 1` e falha
          // com erro de negócio, nunca vende o mesmo IMEI duas vezes.
          const serialClaim = await tx.productSerial.updateMany({
            where: { id: serial.id, tenantId: input.tenantId, status: "IN_STOCK" },
            data: { status: "SOLD" },
          });
          if (serialClaim.count !== 1) {
            throw new SerialAlreadyClaimedError(
              `Serial ${item.serialNumber} acabou de ser reservado/vendido por outra operação concorrente — recarregue o estoque e tente novamente.`,
            );
          }
          // Decremento do agregado também condicional (nunca um `update()` cego):
          // protege contra o mesmo `Product.stockQuantity` já ter sido zerado por
          // outro ajuste concorrente entre a leitura do produto e este ponto.
          const claimedProductStock = await tx.product.updateMany({
            where: { id: product.id, tenantId: input.tenantId, stockQuantity: { gte: 1 } },
            data: { stockQuantity: { decrement: 1 } },
          });
          if (claimedProductStock.count === 0) {
            throw new InsufficientStockError(`Estoque insuficiente do produto ${product.name} para concluir a venda.`);
          }
          claimedSerialIdsInThisSale.add(serial.id);
          soldSerialIds.push(serial.id);
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
            const variant = variantById.get(item.productVariantId);
            if (!variant || variant.productId !== product.id) {
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
          // GAP DE AUDITORIA FECHADO: antes, produtos sem lote/série/variante (o
          // caminho mais comum — mercado/convenência, varejo geral) decrementavam
          // `stockQuantity` com `update()` direto, sem nenhuma guarda `WHERE
          // stockQuantity >= quantidade` nem lock — duas vendas simultâneas da
          // última unidade (ou menos) em dois PDVs/terminais do mesmo tenant
          // podiam ambas "ter sucesso" e deixar o estoque negativo (overselling).
          // Agora é um claim atômico via `updateMany`, mesmo padrão já usado acima
          // para variante e componente de kit: a segunda venda concorrente nunca
          // encontra linhas a atualizar e falha com erro de negócio, nunca com
          // estoque negativo silencioso.
          const claimedProduct = await tx.product.updateMany({
            where: { id: product.id, tenantId: input.tenantId, stockQuantity: { gte: new Prisma.Decimal(item.quantity) } },
            data: { stockQuantity: { decrement: item.quantity } },
          });
          if (claimedProduct.count === 0) {
            throw new InsufficientStockError(`Estoque insuficiente do produto ${product.name} para concluir a venda.`);
          }
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
        //    `calculateFullTax` (21.14) soma, sobre o núcleo de 21.6: DIFAL (21.10),
        //    PIS/COFINS monofásico (21.9), ICMS de veículo usado (21.12) e CFOP
        //    dinâmico (21.13) — item de produto, nunca de mão de obra de O.S.
        const originUf = tenant.uf ?? product.originUf ?? "SP";
        const destinationUf = saleClient?.uf ?? originUf;
        const productRecipe = recipeByProductId.get(product.id) ?? null;
        const taxResult = await calculateFullTax(tx, {
          tenantId: input.tenantId,
          ncm: product.ncm ?? "00000000",
          uf: product.originUf ?? "SP",
          nicheCode: product.nicheCode ?? "MARKET",
          grossAmount: lineGross,
          originUf,
          destinationUf,
          buyerIsIcmsContributor: saleClient?.icmsContributor ?? false,
          isServiceItem: false,
          isOwnProduction: Boolean(productRecipe), // Capítulo 21.13 — produto com Ficha Técnica (BOM) é produção própria do próprio tenant
          isReturn: false,
        });

        legacyIcmsTotal = legacyIcmsTotal.plus(taxResult.legacyIcmsAmount);
        legacyPisCofinsTotal = legacyPisCofinsTotal.plus(taxResult.legacyPisCofinsAmount);
        ibsTotal = ibsTotal.plus(taxResult.ibsAmount);
        cbsTotal = cbsTotal.plus(taxResult.cbsAmount);
        selectiveTaxTotal = selectiveTaxTotal.plus(taxResult.selectiveTaxAmount);
        difalTotal = difalTotal.plus(taxResult.difalAmount);
        monofasicoSegregatedTotal = monofasicoSegregatedTotal.plus(taxResult.monofasicoSegregatedAmount);
        usedVehicleIcmsTotal = usedVehicleIcmsTotal.plus(taxResult.usedVehicleIcmsAmount);
        totalTaxesApprox = totalTaxesApprox
          .plus(taxResult.legacyIcmsAmount)
          .plus(taxResult.legacyPisCofinsAmount)
          .plus(taxResult.ibsAmount)
          .plus(taxResult.cbsAmount)
          .plus(taxResult.selectiveTaxAmount)
          .plus(taxResult.difalAmount)
          .plus(taxResult.usedVehicleIcmsAmount);

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

      // Pagamento Dividido/Split (Capítulo 9) — resolve os dois formatos de entrada
      // possíveis em exatamente UMA lista normalizada de "entradas de pagamento" daqui
      // em diante; todo o restante da função (changeDue, validações de STORE_CREDIT/
      // HEALTH_INSURANCE, criação de `Payment`) opera só sobre `paymentEntries`, nunca
      // mais sobre `input.paymentMethod` diretamente.
      if (input.paymentMethod && input.payments) {
        throw new SplitPaymentValidationError("Informe apenas um dos dois: paymentMethod (método único) OU payments (dividido) — nunca ambos.");
      }
      if (!input.paymentMethod && (!input.payments || input.payments.length === 0)) {
        throw new SplitPaymentValidationError("Informe paymentMethod (método único) ou payments (dividido, 2+ métodos).");
      }
      const paymentEntries: { method: "CASH" | "DEBIT_CARD" | "CREDIT_CARD" | "PIX" | "BOLETO" | "STORE_CREDIT" | "HEALTH_INSURANCE"; amount: Prisma.Decimal; amountTendered?: number }[] =
        input.payments
          ? input.payments.map((p) => ({ method: p.method, amount: new Prisma.Decimal(p.amount).toDecimalPlaces(2), amountTendered: p.amountTendered }))
          : [{ method: input.paymentMethod!, amount: totalAmount, amountTendered: input.amountTendered }];

      const paymentEntriesSum = paymentEntries.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
      // Tolerância de 1 centavo: o cliente (PDV web) já arredonda para 2 casas antes de
      // enviar, mas comparar por igualdade EXATA de Decimal é frágil contra qualquer
      // resíduo de ponto flutuante vindo de um chamador diferente (ex.: app desktop,
      // integração via API pública) — comparar os valores já arredondados para
      // centavos evita rejeitar uma venda legítima por uma fração de centavo
      // inteiramente artificial, sem abrir margem para uma venda genuinamente
      // incompleta (toFixed(2) ainda é fiel ao valor financeiro real em reais).
      if (!paymentEntriesSum.toDecimalPlaces(2).equals(totalAmount.toDecimalPlaces(2))) {
        throw new SplitPaymentValidationError(
          `A soma dos pagamentos (${paymentEntriesSum.toFixed(2)}) não bate com o total da venda (${totalAmount.toFixed(2)}).`,
        );
      }
      const distinctMethods = new Set(paymentEntries.map((p) => p.method));
      if (paymentEntries.length > 1 && (distinctMethods.has("STORE_CREDIT") || distinctMethods.has("HEALTH_INSURANCE"))) {
        throw new SplitPaymentValidationError(
          "STORE_CREDIT e HEALTH_INSURANCE não podem ser combinados com outro método na mesma venda — cada um exige o valor cheio da venda (crediário/fatura de convênio consolidada).",
        );
      }
      // Rótulo agregado gravado em `Sale.paymentMethod`: o método único de fato usado,
      // ou MIXED quando a venda tem 2+ métodos distintos reais.
      const resolvedSalePaymentMethod = distinctMethods.size === 1 ? paymentEntries[0].method : "MIXED";

      const changeDue = paymentEntries
        .filter((p) => p.method === "CASH" && p.amountTendered)
        .reduce((sum, p) => sum.plus(Prisma.Decimal.max(0, new Prisma.Decimal(p.amountTendered!).minus(p.amount))), new Prisma.Decimal(0));

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
      // Split Payment: STORE_CREDIT nunca é combinado (validado acima), então
      // `storeCreditEntry?.amount` é sempre o valor cheio da venda quando presente.
      const storeCreditEntry = paymentEntries.find((p) => p.method === "STORE_CREDIT");
      if (storeCreditEntry) {
        if (!input.clientId) {
          throw new ClientRequiredForStoreCreditError("Venda a prazo (STORE_CREDIT) exige a seleção do cliente.");
        }
        const client = await tx.client.findFirst({
          where: { id: input.clientId, tenantId: input.tenantId },
          select: { creditLimit: true },
        });
        const availableLimit = (client?.creditLimit ?? new Prisma.Decimal(0)).minus(storeCreditEntry.amount);
        const claimedCredit = await tx.client.updateMany({
          where: {
            id: input.clientId,
            tenantId: input.tenantId,
            creditBalanceUsed: { lte: availableLimit },
          },
          data: { creditBalanceUsed: { increment: storeCreditEntry.amount } },
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
      if (paymentEntries.some((p) => p.method === "HEALTH_INSURANCE")) {
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
          paymentMethod: resolvedSalePaymentMethod,
          status: "PAID",
          totalAmount,
          ...(healthInsurancePlanId ? { healthInsurancePlanId } : {}),
        },
      });

      // GAP DE AUDITORIA FECHADO (Rodada 6): vincula cada serial/IMEI vendido nesta
      // venda ao `sale.id` recém-criado — sem isto, `refund-sale.service.ts` não tinha
      // nenhuma forma de identificar qual unidade serializada devolver a IN_STOCK no
      // estorno.
      if (soldSerialIds.length > 0) {
        await tx.productSerial.updateMany({ where: { id: { in: soldSerialIds } }, data: { saleId: sale.id } });
      }

      // CORREÇÃO DE AUDITORIA (fa-w5-perf-pdv-item-inserts): antes, TODO SaleItem era
      // criado individualmente (um INSERT por item, nunca em lote) só para poder
      // encadear, em seguida, o `PrescriptionRecord` de itens com retenção de receita
      // (Capítulo 4.5) — que de fato PRECISA do `id` real do SaleItem recém-criado
      // (`PrescriptionRecord.saleItemId` é FK obrigatória e @unique). Só essa minoria
      // de itens (produto de retenção obrigatória/substância controlada) genuinamente
      // precisa do id de volta imediatamente nesta mesma transação — a maioria dos
      // itens de um carrinho comum (sem receita) não depende de nada subsequente e é
      // inserida de uma vez via `createMany`. `saleItemsData` e `input.items` mantêm o
      // mesmo índice: o loop anterior faz exatamente um `push` por item de
      // `input.items`, nunca pulando nenhum.
      const itemIndexesNeedingPrescription: number[] = [];
      const saleItemsWithoutPrescription: Prisma.SaleItemCreateManySaleInput[] = [];
      for (let i = 0; i < saleItemsData.length; i++) {
        if (input.items[i]?.prescriptionData) {
          itemIndexesNeedingPrescription.push(i);
        } else {
          saleItemsWithoutPrescription.push(saleItemsData[i]);
        }
      }

      if (saleItemsWithoutPrescription.length > 0) {
        await tx.saleItem.createMany({
          data: saleItemsWithoutPrescription.map((data) => ({ ...data, saleId: sale.id })),
        });
      }

      if (itemIndexesNeedingPrescription.length > 0) {
        const prescriptionRecordsData: Prisma.PrescriptionRecordCreateManyInput[] = [];
        for (const i of itemIndexesNeedingPrescription) {
          const createdItem = await tx.saleItem.create({ data: { ...saleItemsData[i], saleId: sale.id } });
          const prescriptionData = input.items[i]!.prescriptionData!;
          prescriptionRecordsData.push({
            tenantId: input.tenantId,
            saleItemId: createdItem.id,
            prescriptionType: prescriptionData.prescriptionType,
            patientDocument: prescriptionData.patientDocument,
            electronicPrescriptionNumber: prescriptionData.electronicPrescriptionNumber ?? null,
            retainedDocumentStorageKey: prescriptionData.retainedDocumentStorageKey ?? null,
            validatedByUserId: input.cashierId,
          });
        }
        // PrescriptionRecord em si não precisa do id de volta em nenhum ponto
        // subsequente desta transação — lote único mesmo quando há múltiplos itens
        // com receita no mesmo carrinho (ex.: dois medicamentos controlados).
        await tx.prescriptionRecord.createMany({ data: prescriptionRecordsData });
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

      // Capítulo 4.3 — Adega/Bebidas: materializa o lançamento BORROWED na
      // conta-corrente de cascos para cada produto retornável vendido — fecha o gap
      // documentado no header de `liquor-ledger.routes.ts` (o lançamento deixa de
      // depender exclusivamente do POST manual `/liquor-ledger/entries`).
      for (const containerEntry of returnableContainerEntries) {
        await tx.returnableContainerLedger.create({
          data: {
            tenantId: input.tenantId,
            clientId: input.clientId!,
            productId: containerEntry.productId,
            direction: "BORROWED",
            quantity: containerEntry.quantity,
            saleId: sale.id,
          },
        });
      }

      // Pagamento Dividido/Split: um `Payment` por entrada de `paymentEntries`, nunca
      // mais um único row fixo — cada idempotencyKey ganha sufixo de índice para
      // respeitar o `@@unique` da tabela mesmo quando o mesmo método se repete (ex.:
      // duas entradas CASH, caso raro mas válido: cliente paga parte com uma nota e
      // parte com outra forma de troco combinada no caixa).
      for (let i = 0; i < paymentEntries.length; i++) {
        const entry = paymentEntries[i];
        const entryChangeDue =
          entry.method === "CASH" && entry.amountTendered
            ? Prisma.Decimal.max(0, new Prisma.Decimal(entry.amountTendered).minus(entry.amount))
            : new Prisma.Decimal(0);
        await tx.payment.create({
          data: {
            tenantId: input.tenantId,
            saleId: sale.id,
            method: entry.method,
            status: "CONFIRMED",
            amount: entry.amount,
            changeDue: entryChangeDue,
            idempotencyKey: `${input.idempotencyKey}:payment:${i}`,
          },
        });
      }

      // 3. FiscalDocument nasce PENDING nesta mesma transação — nunca criado depois, de
      //    forma desacoplada, o que abriria uma janela em que a venda existe sem nenhum
      //    documento fiscal correspondente ainda sendo rastreado.
      const fiscalDocument = await tx.fiscalDocument.create({
        data: {
          tenantId: input.tenantId,
          type: "NFCE",
          status: fiscalNfceContracted ? "PENDING" : "NOT_CONTRACTED",
          saleId: sale.id,
          legacyIcmsAmount: legacyIcmsTotal,
          legacyPisCofinsAmount: legacyPisCofinsTotal,
          ibsAmount: ibsTotal,
          cbsAmount: cbsTotal,
          selectiveTaxAmount: selectiveTaxTotal,
          difalAmount: difalTotal,
          monofasicoSegregatedRevenue: monofasicoSegregatedTotal,
          usedVehicleIcmsAmount: usedVehicleIcmsTotal,
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
export async function closeSaleAndEmitFiscalDocument(prisma: TenantScopedPrismaClient, input: CloseSaleServerInput) {
  const result = await closeSale(prisma, input);
  if (result.fiscalDocument && result.fiscalDocument.status !== "NOT_CONTRACTED") {
    // CORREÇÃO DE AUDITORIA (mega-audit round 7): quando este `enqueue` lançava (ex.:
    // Redis momentaneamente fora do ar), a exceção subia ANTES do dispatch do webhook
    // mas DEPOIS do commit da venda — a requisição HTTP retornava erro para o PDV
    // mesmo com a venda já registrada. Pior ainda: como o fluxo só reenfileirava a
    // emissão fiscal em `!result.isReplay`, um retry do PDV com a MESMA chave de
    // idempotência (replay) nunca tentava de novo — o `FiscalDocument` ficava PENDING
    // para sempre, sem nenhum job jamais ter entrado na fila. Agora: (1) nunca deixa o
    // enqueue derrubar a resposta HTTP da venda (try/catch, como já era feito no
    // dispatch do webhook logo abaixo); (2) tenta reenfileirar mesmo em replay, desde
    // que o documento ainda esteja PENDING — reenfileirar é seguro mesmo se já exista
    // um job anterior em processamento, pois `emitFiscalDocument` é idempotente
    // (retorna imediatamente se o status já avançou para AUTHORIZED/CANCELLED). Uma
    // verredura periódica (`workers/reconcile-stuck-fiscal-documents.worker.ts`) cobre
    // o caso residual de nenhum retry de replay jamais acontecer.
    if (!result.isReplay || result.fiscalDocument.status === "PENDING") {
      try {
        await enqueueFiscalEmission({
          fiscalDocumentId: result.fiscalDocument.id,
          tenantId: input.tenantId,
          requestId: input.requestId,
        });
      } catch (error) {
        createModuleLogger("close-sale").error(
          { saleId: result.sale.id, fiscalDocumentId: result.fiscalDocument.id, err: error },
          "falha ao enfileirar emissão fiscal — venda já está confirmada; a varredura periódica de documentos PENDING reconciliará depois",
        );
      }
    }
  }
  if (!result.isReplay) {
    // Capítulo 15.4 — webhook de saída "sale.completed" (ver schema.prisma,
    // TenantWebhookEndpoint.eventTypes). Não bloqueia o fechamento da venda caso o
    // próprio enfileiramento do dispatch falhe (ex.: Redis fora do ar) — o fluxo
    // crítico (venda registrada) nunca pode depender de uma integração opcional.
    await dispatchWebhookEvent(
      input.tenantId,
      "sale.completed",
      {
        saleId: result.sale.id,
        totalAmount: result.sale.totalAmount,
        channel: result.sale.channel,
        closedAt: result.sale.createdAt,
      },
      input.requestId,
    ).catch((error) => {
      createModuleLogger("close-sale").error({ saleId: result.sale.id, err: error }, "falha ao enfileirar webhook sale.completed");
    });
  }
  return result;
}
