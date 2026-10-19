// apps/api/tests/stock/fifo-fefo-bom.test.ts
// GAP DE AUDITORIA FECHADO (fa-test-fifo-fefo-bom-missing): nenhum teste real existia
// para o algoritmo FEFO de dedução de estoque (deduct-stock-fefo.service.ts) nem para
// a baixa de Ficha Técnica/BOM (consume-recipe-for-comanda-item.service.ts e
// produce-recipe-batch.service.ts). Esta suíte roda contra um Postgres REAL de teste
// (nunca mock de Prisma) — cria um tenant + produtos + lotes de verdade via
// `prismaUnscoped`, aciona as funções de serviço dentro do contexto de tenant real
// (`runWithTenantContext`) e confere o estado final no banco, incluindo rollback
// transacional em caso de falha (nenhum StockMovement/decremento parcial deve
// sobreviver quando a função lança).
//
// Requer DATABASE_URL de teste com as migrations aplicadas (`npx prisma migrate deploy`
// em packages/db) antes de rodar `npm run test` no workspace apps/api — mesmo
// requisito documentado em tests/tenant-isolation.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma, prismaUnscoped, runWithTenantContext } from "@filitech/db";
import { deductStockFefo, InsufficientStockError } from "../../src/services/stock/deduct-stock-fefo.service";
import {
  consumeRecipeForComandaItem,
  MissingIngredientStockError as ComandaMissingIngredientStockError,
} from "../../src/services/production/consume-recipe-for-comanda-item.service";
import {
  produceRecipeBatch,
  MissingIngredientStockError as BatchMissingIngredientStockError,
} from "../../src/services/production/produce-recipe-batch.service";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createTestTenant(prefix: string) {
  return prismaUnscoped.tenant.create({
    data: {
      slug: uniqueSlug(prefix),
      legalName: `${prefix} LTDA`,
      tradeName: prefix,
      tenantType: "PERSONAL",
      status: "ACTIVE",
    },
  });
}

async function createTestUser(tenantId: string, prefix: string) {
  return prismaUnscoped.user.create({
    data: {
      tenantId,
      name: `${prefix} User`,
      email: `${uniqueSlug(prefix)}@fifo-fefo-bom.test`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
}

describe("FEFO de estoque e Ficha Técnica/BOM — testes reais contra Postgres (Capítulo 6.2/6.3/11.1)", () => {
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    tenant = await createTestTenant("fifo-fefo-bom");
    user = await createTestUser(tenant.id, "fifo-fefo-bom");
  });

  afterAll(async () => {
    // Limpeza em cascata manual — segue o mesmo padrão de tenant-isolation.test.ts
    // (nunca apaga o Tenant em si, apenas os registros criados por esta suíte).
    await prismaUnscoped.stockMovement.deleteMany({ where: { tenantId: tenant.id } });
    await prismaUnscoped.productionBatch.deleteMany({ where: { tenantId: tenant.id } });
    await prismaUnscoped.comandaItem.deleteMany({ where: { tenantId: tenant.id } });
    await prismaUnscoped.comanda.deleteMany({ where: { tenantId: tenant.id } });
    await prismaUnscoped.recipeItem.deleteMany({ where: { tenantId: tenant.id } });
    await prismaUnscoped.recipe.deleteMany({ where: { tenantId: tenant.id } });
    await prismaUnscoped.productBatch.deleteMany({ where: { tenantId: tenant.id } });
    await prismaUnscoped.product.deleteMany({ where: { tenantId: tenant.id } });
    await prismaUnscoped.user.deleteMany({ where: { tenantId: tenant.id } });
    await prismaUnscoped.$disconnect();
  });

  async function createProduct(sku: string, stockQuantity = 0) {
    return prismaUnscoped.product.create({
      data: {
        tenantId: tenant.id,
        sku,
        name: sku,
        unitPrice: new Prisma.Decimal(10),
        stockQuantity: new Prisma.Decimal(stockQuantity),
      },
    });
  }

  function runAsTenant<T>(callback: () => Promise<T>): Promise<T> {
    return runWithTenantContext({ tenantId: tenant.id, userId: user.id, role: "OWNER" }, callback);
  }

  describe("deductStockFefo — multiplos lotes, validade e estoque insuficiente", () => {
    it("consome primeiro o lote de validade mais próxima, deixando o lote mais distante intocado", async () => {
      const product = await createProduct(uniqueSlug("SKU-FEFO-A"));
      const soonBatch = await prismaUnscoped.productBatch.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          batchNumber: "LOTE-PROXIMO",
          expirationDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          quantity: new Prisma.Decimal(10),
        },
      });
      const farBatch = await prismaUnscoped.productBatch.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          batchNumber: "LOTE-DISTANTE",
          expirationDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          quantity: new Prisma.Decimal(10),
        },
      });

      const movements = await runAsTenant(() =>
        deductStockFefo(prisma, { tenantId: tenant.id, productId: product.id, quantity: new Prisma.Decimal(4), saleItemId: "sale-item-1" }),
      );

      expect(movements).toHaveLength(1);
      expect(movements[0].batchId).toBe(soonBatch.id);
      expect(movements[0].quantityTaken.toNumber()).toBe(4);

      const reloadedSoon = await prismaUnscoped.productBatch.findUniqueOrThrow({ where: { id: soonBatch.id } });
      const reloadedFar = await prismaUnscoped.productBatch.findUniqueOrThrow({ where: { id: farBatch.id } });
      expect(reloadedSoon.quantity.toNumber()).toBe(6); // 10 - 4
      expect(reloadedFar.quantity.toNumber()).toBe(10); // intocado

      const reloadedProduct = await prismaUnscoped.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(reloadedProduct.stockQuantity.toNumber()).toBe(-4); // partiu de 0

      const movementRows = await prismaUnscoped.stockMovement.findMany({ where: { tenantId: tenant.id, productId: product.id } });
      expect(movementRows).toHaveLength(1);
      expect(movementRows[0].productBatchId).toBe(soonBatch.id);
      expect(movementRows[0].quantity.toNumber()).toBe(-4);
    });

    it("quando o primeiro lote não basta, consome o segundo lote (ordem crescente de validade)", async () => {
      const product = await createProduct(uniqueSlug("SKU-FEFO-B"));
      const soonBatch = await prismaUnscoped.productBatch.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          batchNumber: "LOTE-PROXIMO",
          expirationDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          quantity: new Prisma.Decimal(3),
        },
      });
      const farBatch = await prismaUnscoped.productBatch.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          batchNumber: "LOTE-DISTANTE",
          expirationDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          quantity: new Prisma.Decimal(10),
        },
      });

      const movements = await runAsTenant(() =>
        deductStockFefo(prisma, { tenantId: tenant.id, productId: product.id, quantity: new Prisma.Decimal(5), saleItemId: "sale-item-2" }),
      );

      expect(movements).toHaveLength(2);
      expect(movements[0].batchId).toBe(soonBatch.id);
      expect(movements[0].quantityTaken.toNumber()).toBe(3);
      expect(movements[1].batchId).toBe(farBatch.id);
      expect(movements[1].quantityTaken.toNumber()).toBe(2);

      const reloadedSoon = await prismaUnscoped.productBatch.findUniqueOrThrow({ where: { id: soonBatch.id } });
      const reloadedFar = await prismaUnscoped.productBatch.findUniqueOrThrow({ where: { id: farBatch.id } });
      expect(reloadedSoon.quantity.toNumber()).toBe(0);
      expect(reloadedFar.quantity.toNumber()).toBe(8); // 10 - 2
    });

    it("bloqueia lote vencido — nunca considerado candidato, mesmo com quantidade física disponível", async () => {
      const product = await createProduct(uniqueSlug("SKU-FEFO-EXPIRED"));
      await prismaUnscoped.productBatch.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          batchNumber: "LOTE-VENCIDO",
          expirationDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // ontem
          quantity: new Prisma.Decimal(100),
        },
      });

      await expect(
        runAsTenant(() =>
          deductStockFefo(prisma, { tenantId: tenant.id, productId: product.id, quantity: new Prisma.Decimal(1), saleItemId: "sale-item-3" }),
        ),
      ).rejects.toThrow(InsufficientStockError);

      // Defesa em profundidade: o lote vencido continua com 100 unidades intocadas —
      // a rejeição não deve ter decrementado nada dele.
      const reloaded = await prismaUnscoped.productBatch.findFirstOrThrow({ where: { tenantId: tenant.id, productId: product.id } });
      expect(reloaded.quantity.toNumber()).toBe(100);
    });

    it("rejeita quando o estoque dentro da validade é insuficiente e NÃO deixa decremento parcial (rollback transacional)", async () => {
      const product = await createProduct(uniqueSlug("SKU-FEFO-INSUFFICIENT"));
      const batch = await prismaUnscoped.productBatch.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          batchNumber: "LOTE-PARCIAL",
          expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          quantity: new Prisma.Decimal(3),
        },
      });

      await expect(
        runAsTenant(() =>
          deductStockFefo(prisma, { tenantId: tenant.id, productId: product.id, quantity: new Prisma.Decimal(10), saleItemId: "sale-item-4" }),
        ),
      ).rejects.toThrow(InsufficientStockError);

      // O lote de 3 unidades teria sido parcialmente consumido pelo loop ANTES da
      // checagem final de `remaining > 0` — a transação precisa desfazer esse
      // decremento parcial junto com o erro, nunca deixar o lote em 0.
      const reloadedBatch = await prismaUnscoped.productBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(reloadedBatch.quantity.toNumber()).toBe(3);

      const reloadedProduct = await prismaUnscoped.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(reloadedProduct.stockQuantity.toNumber()).toBe(0);

      const movementRows = await prismaUnscoped.stockMovement.findMany({ where: { tenantId: tenant.id, productId: product.id } });
      expect(movementRows).toHaveLength(0);
    });
  });

  describe("consumeRecipeForComandaItem — baixa de Ficha Técnica no lançamento do item de comanda (Capítulo 11.1)", () => {
    async function createRecipeFixture(yieldQuantity: number, quantityPerYield: number, ingredientStock: number) {
      const ingredient = await createProduct(uniqueSlug("SKU-INGREDIENTE"), ingredientStock);
      const finishedProduct = await createProduct(uniqueSlug("SKU-PRATO"));
      await prismaUnscoped.recipe.create({
        data: {
          tenantId: tenant.id,
          productId: finishedProduct.id,
          yieldQuantity: new Prisma.Decimal(yieldQuantity),
          items: {
            create: [{ tenantId: tenant.id, ingredientId: ingredient.id, quantityPerYield: new Prisma.Decimal(quantityPerYield) }],
          },
        },
      });
      const comanda = await prismaUnscoped.comanda.create({ data: { tenantId: tenant.id } });
      return { ingredient, finishedProduct, comanda };
    }

    it("calcula o consumo PROPORCIONAL corretamente (quantidade do item / rendimento da receita)", async () => {
      // Receita rende 1 unidade do prato e usa 0.2kg do ingrediente por unidade —
      // lançar 3 unidades do prato deve baixar 0.6kg do ingrediente.
      const { ingredient, finishedProduct, comanda } = await createRecipeFixture(1, 0.2, 10);
      const item = await prismaUnscoped.comandaItem.create({
        data: { tenantId: tenant.id, comandaId: comanda.id, productId: finishedProduct.id, quantity: new Prisma.Decimal(3), unitPrice: new Prisma.Decimal(20) },
      });

      const result = await runAsTenant(() => consumeRecipeForComandaItem(prisma, { tenantId: tenant.id, comandaItemId: item.id }));
      expect(result).toEqual({ consumed: true });

      const reloadedIngredient = await prismaUnscoped.product.findUniqueOrThrow({ where: { id: ingredient.id } });
      expect(reloadedIngredient.stockQuantity.toNumber()).toBeCloseTo(10 - 0.6, 6);

      const reloadedItem = await prismaUnscoped.comandaItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(reloadedItem.recipeConsumedAt).not.toBeNull();
    });

    it("é idempotente: uma segunda chamada no mesmo item já consumido NÃO baixa o insumo de novo", async () => {
      const { ingredient, finishedProduct, comanda } = await createRecipeFixture(1, 1, 10);
      const item = await prismaUnscoped.comandaItem.create({
        data: { tenantId: tenant.id, comandaId: comanda.id, productId: finishedProduct.id, quantity: new Prisma.Decimal(2), unitPrice: new Prisma.Decimal(20) },
      });

      const first = await runAsTenant(() => consumeRecipeForComandaItem(prisma, { tenantId: tenant.id, comandaItemId: item.id }));
      expect(first).toEqual({ consumed: true });

      const second = await runAsTenant(() => consumeRecipeForComandaItem(prisma, { tenantId: tenant.id, comandaItemId: item.id }));
      expect(second).toEqual({ consumed: false, reason: "ALREADY_CONSUMED" });

      const reloadedIngredient = await prismaUnscoped.product.findUniqueOrThrow({ where: { id: ingredient.id } });
      // Consumido apenas UMA vez (2 unidades de 1kg cada = 2kg), não duas.
      expect(reloadedIngredient.stockQuantity.toNumber()).toBe(8);
    });

    it("rejeita por insumo insuficiente e desfaz (rollback) qualquer decremento parcial entre múltiplos insumos", async () => {
      const ingredientA = await createProduct(uniqueSlug("SKU-INGREDIENTE-A"), 100); // abundante
      const ingredientB = await createProduct(uniqueSlug("SKU-INGREDIENTE-B"), 1); // escasso
      const finishedProduct = await createProduct(uniqueSlug("SKU-PRATO-MULTI"));
      await prismaUnscoped.recipe.create({
        data: {
          tenantId: tenant.id,
          productId: finishedProduct.id,
          yieldQuantity: new Prisma.Decimal(1),
          items: {
            create: [
              { tenantId: tenant.id, ingredientId: ingredientA.id, quantityPerYield: new Prisma.Decimal(1) },
              { tenantId: tenant.id, ingredientId: ingredientB.id, quantityPerYield: new Prisma.Decimal(5) },
            ],
          },
        },
      });
      const comanda = await prismaUnscoped.comanda.create({ data: { tenantId: tenant.id } });
      const item = await prismaUnscoped.comandaItem.create({
        data: { tenantId: tenant.id, comandaId: comanda.id, productId: finishedProduct.id, quantity: new Prisma.Decimal(1), unitPrice: new Prisma.Decimal(20) },
      });

      await expect(
        runAsTenant(() => consumeRecipeForComandaItem(prisma, { tenantId: tenant.id, comandaItemId: item.id })),
      ).rejects.toThrow(ComandaMissingIngredientStockError);

      // O ingrediente A (abundante, processado ANTES do insumo escasso na ordem de
      // criação) não pode ter sido decrementado — a transação inteira desfaz.
      const reloadedA = await prismaUnscoped.product.findUniqueOrThrow({ where: { id: ingredientA.id } });
      expect(reloadedA.stockQuantity.toNumber()).toBe(100);

      const reloadedItem = await prismaUnscoped.comandaItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(reloadedItem.recipeConsumedAt).toBeNull();
    });
  });

  describe("produceRecipeBatch — baixa de BOM na produção (padaria/confeitaria, Capítulo 6.3)", () => {
    it("calcula o consumo proporcional de insumos e credita apenas a quantidade líquida (produzida - perdida) no estoque vendável", async () => {
      const ingredient = await createProduct(uniqueSlug("SKU-FARINHA"), 50);
      const finishedProduct = await createProduct(uniqueSlug("SKU-PAO"), 0);
      await prismaUnscoped.recipe.create({
        data: {
          tenantId: tenant.id,
          productId: finishedProduct.id,
          yieldQuantity: new Prisma.Decimal(10), // rende 10 pães
          items: { create: [{ tenantId: tenant.id, ingredientId: ingredient.id, quantityPerYield: new Prisma.Decimal(2) }] }, // 2kg farinha por 10 pães
        },
      });

      const batch = await runAsTenant(() =>
        produceRecipeBatch(prisma, {
          tenantId: tenant.id,
          finishedProductId: finishedProduct.id,
          quantityProduced: new Prisma.Decimal(20), // 2 fornadas inteiras
          quantityLost: new Prisma.Decimal(2),
          lossReasonCode: "QUEIMOU_FORNO",
          producedByUserId: user.id,
        }),
      );

      expect(batch.status).toBe("PARTIALLY_LOST");

      const reloadedIngredient = await prismaUnscoped.product.findUniqueOrThrow({ where: { id: ingredient.id } });
      // productionRatio = 20/10 = 2 -> consumo = 2kg * 2 = 4kg
      expect(reloadedIngredient.stockQuantity.toNumber()).toBe(46);

      const reloadedFinished = await prismaUnscoped.product.findUniqueOrThrow({ where: { id: finishedProduct.id } });
      expect(reloadedFinished.stockQuantity.toNumber()).toBe(18); // 20 produzidos - 2 perdidos

      const lossMovement = await prismaUnscoped.stockMovement.findFirst({
        where: { tenantId: tenant.id, productId: finishedProduct.id, type: "LOSS" },
      });
      expect(lossMovement?.quantity.toNumber()).toBe(-2);
    });

    it("rejeita por insumo insuficiente e NÃO cria ProductionBatch nem credita estoque (rollback transacional)", async () => {
      const ingredient = await createProduct(uniqueSlug("SKU-FARINHA-ESCASSA"), 1);
      const finishedProduct = await createProduct(uniqueSlug("SKU-PAO-ESCASSO"), 0);
      await prismaUnscoped.recipe.create({
        data: {
          tenantId: tenant.id,
          productId: finishedProduct.id,
          yieldQuantity: new Prisma.Decimal(1),
          items: { create: [{ tenantId: tenant.id, ingredientId: ingredient.id, quantityPerYield: new Prisma.Decimal(5) }] },
        },
      });

      await expect(
        runAsTenant(() =>
          produceRecipeBatch(prisma, {
            tenantId: tenant.id,
            finishedProductId: finishedProduct.id,
            quantityProduced: new Prisma.Decimal(3),
            producedByUserId: user.id,
          }),
        ),
      ).rejects.toThrow(BatchMissingIngredientStockError);

      const reloadedIngredient = await prismaUnscoped.product.findUniqueOrThrow({ where: { id: ingredient.id } });
      expect(reloadedIngredient.stockQuantity.toNumber()).toBe(1); // intocado

      const reloadedFinished = await prismaUnscoped.product.findUniqueOrThrow({ where: { id: finishedProduct.id } });
      expect(reloadedFinished.stockQuantity.toNumber()).toBe(0); // nenhum crédito parcial

      const batches = await prismaUnscoped.productionBatch.findMany({ where: { tenantId: tenant.id, finishedProductId: finishedProduct.id } });
      expect(batches).toHaveLength(0);
    });
  });

  describe("Concorrência — duas deduções FEFO simultâneas no mesmo SKU nunca sobre-consomem o lote", () => {
    it("dispara duas deduções concorrentes reais (Promise.all) contra o mesmo lote e garante que a soma final bate", async () => {
      const product = await createProduct(uniqueSlug("SKU-FEFO-CONCURRENT"));
      await prismaUnscoped.productBatch.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          batchNumber: "LOTE-CONCORRENTE",
          expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          quantity: new Prisma.Decimal(10),
        },
      });

      // Duas deduções de 6 unidades cada contra um lote de 10: juntas excedem o
      // estoque disponível — o lock pessimista (`FOR UPDATE`) + isolamento
      // Serializable devem serializar as duas transações de forma que NO MÁXIMO uma
      // combinação de sucesso/falha deixe o lote consistente (nunca as duas tiradas
      // de 6 computadas sobre a MESMA leitura de "10 disponíveis", o que deixaria o
      // lote negativo).
      const results = await Promise.allSettled([
        runAsTenant(() => deductStockFefo(prisma, { tenantId: tenant.id, productId: product.id, quantity: new Prisma.Decimal(6), saleItemId: "concurrent-1" })),
        runAsTenant(() => deductStockFefo(prisma, { tenantId: tenant.id, productId: product.id, quantity: new Prisma.Decimal(6), saleItemId: "concurrent-2" })),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      // Exatamente uma das duas deve ter sucesso (a outra rejeita por estoque
      // insuficiente ou erro de serialização do Postgres) — nunca as duas.
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const reloadedBatch = await prismaUnscoped.productBatch.findFirstOrThrow({ where: { tenantId: tenant.id, productId: product.id } });
      expect(reloadedBatch.quantity.toNumber()).toBe(4); // 10 - 6, nunca negativo nem -2
    });
  });
});
