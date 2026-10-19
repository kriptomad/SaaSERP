// apps/api/tests/tenant-contract/tenant-extension-contract.test.ts
// GAP DE AUDITORIA FECHADO (fa-test-tenant-extension-contract): o único teste de
// isolamento multi-tenant existente (`tenant-isolation.test.ts`) exercita a
// extension via HTTP apenas para `Client`/`Product`. Este arquivo testa o
// CONTRATO DIRETO da Prisma Client Extension (`createTenantScopedPrismaClient`,
// Capítulo 7.1) contra o cliente `prisma` real (não mockado) para outros modelos
// tenant-scoped críticos: `ProductBatch` (estoque/FEFO), `AccountReceivable`
// (financeiro) e `CashRegister` (PDV/caixa) — cobrindo findMany/findUnique/
// update/delete cross-tenant bloqueados, sem passar por nenhuma rota HTTP.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, prismaUnscoped, runWithTenantContext } from "@filitech/db";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

describe("Contrato da Prisma Tenant Extension — ProductBatch, AccountReceivable, CashRegister", () => {
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let productAId: string;
  let batchAId: string;
  let receivableAId: string;
  let cashRegisterAId: string;

  beforeAll(async () => {
    const tenantA = await prismaUnscoped.tenant.create({
      data: { slug: uniqueSlug("contract-tenant-a"), legalName: "Contrato A LTDA", tradeName: "Contrato A", tenantType: "PERSONAL", status: "ACTIVE" },
    });
    const tenantB = await prismaUnscoped.tenant.create({
      data: { slug: uniqueSlug("contract-tenant-b"), legalName: "Contrato B LTDA", tradeName: "Contrato B", tenantType: "PERSONAL", status: "ACTIVE" },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const userA = await prismaUnscoped.user.create({
      data: { tenantId: tenantAId, name: "Owner A", email: `${uniqueSlug("owner-a")}@contrato-canario.test`, passwordHash: "placeholder", role: "OWNER" },
    });
    userAId = userA.id;

    const productA = await prismaUnscoped.product.create({
      data: { tenantId: tenantAId, sku: `SKU-CONTRACT-${Date.now()}`, name: "Produto Contrato A", unitPrice: 10, stockQuantity: 0 },
    });
    productAId = productA.id;

    const batchA = await prismaUnscoped.productBatch.create({
      data: { tenantId: tenantAId, productId: productAId, batchNumber: "LOTE-A-1", expirationDate: new Date(Date.now() + 86_400_000 * 30), quantity: 50 },
    });
    batchAId = batchA.id;

    const receivableA = await prismaUnscoped.accountReceivable.create({
      data: { tenantId: tenantAId, description: "Conta a receber exclusiva do Tenant A", amount: 500, dueDate: new Date(Date.now() + 86_400_000 * 10) },
    });
    receivableAId = receivableA.id;

    const cashRegisterA = await prismaUnscoped.cashRegister.create({
      data: { tenantId: tenantAId, openedById: userAId, openingAmount: 100 },
    });
    cashRegisterAId = cashRegisterA.id;
  });

  afterAll(async () => {
    await prismaUnscoped.cashRegister.deleteMany({ where: { tenantId: tenantAId } });
    await prismaUnscoped.accountReceivable.deleteMany({ where: { tenantId: tenantAId } });
    await prismaUnscoped.productBatch.deleteMany({ where: { tenantId: tenantAId } });
    await prismaUnscoped.product.deleteMany({ where: { tenantId: tenantAId } });
    await prismaUnscoped.user.deleteMany({ where: { tenantId: tenantAId } });
    await prismaUnscoped.$disconnect();
  });

  describe("ProductBatch (estoque/FEFO)", () => {
    it("findMany sob contexto do Tenant B NUNCA retorna lotes do Tenant A", async () => {
      const batches = await runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () => prisma.productBatch.findMany({}));
      expect(batches.find((b) => b.id === batchAId)).toBeUndefined();
    });

    it("findUnique por id sob contexto do Tenant B não encontra o lote do Tenant A", async () => {
      const found = await runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () =>
        prisma.productBatch.findUnique({ where: { id: batchAId } }),
      );
      expect(found).toBeNull();
    });

    it("update sob contexto do Tenant B NÃO altera o lote do Tenant A (bloqueado pela extensão)", async () => {
      await expect(
        runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () =>
          prisma.productBatch.update({ where: { id: batchAId }, data: { quantity: 999 } }),
        ),
      ).rejects.toBeTruthy();

      const untouched = await prismaUnscoped.productBatch.findUnique({ where: { id: batchAId } });
      expect(Number(untouched?.quantity)).toBe(50);
    });

    it("delete sob contexto do Tenant B NÃO apaga o lote do Tenant A", async () => {
      await expect(
        runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () => prisma.productBatch.delete({ where: { id: batchAId } })),
      ).rejects.toBeTruthy();

      const stillThere = await prismaUnscoped.productBatch.findUnique({ where: { id: batchAId } });
      expect(stillThere).not.toBeNull();
    });

    it("sob o contexto CORRETO (Tenant A) a extensão permite leitura/escrita normalmente (sanity check)", async () => {
      const found = await runWithTenantContext({ tenantId: tenantAId, userId: userAId, role: "OWNER" }, () =>
        prisma.productBatch.findUnique({ where: { id: batchAId } }),
      );
      expect(found?.id).toBe(batchAId);
    });
  });

  describe("AccountReceivable (financeiro)", () => {
    it("findMany sob contexto do Tenant B NUNCA retorna contas a receber do Tenant A", async () => {
      const receivables = await runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () => prisma.accountReceivable.findMany({}));
      expect(receivables.find((r) => r.id === receivableAId)).toBeUndefined();
    });

    it("update sob contexto do Tenant B NÃO altera a conta a receber do Tenant A", async () => {
      await expect(
        runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () =>
          prisma.accountReceivable.update({ where: { id: receivableAId }, data: { status: "PAID" } }),
        ),
      ).rejects.toBeTruthy();

      const untouched = await prismaUnscoped.accountReceivable.findUnique({ where: { id: receivableAId } });
      expect(untouched?.status).toBe("PENDING");
    });

    it("delete sob contexto do Tenant B NÃO apaga a conta a receber do Tenant A", async () => {
      await expect(
        runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () => prisma.accountReceivable.delete({ where: { id: receivableAId } })),
      ).rejects.toBeTruthy();

      const stillThere = await prismaUnscoped.accountReceivable.findUnique({ where: { id: receivableAId } });
      expect(stillThere).not.toBeNull();
    });
  });

  describe("CashRegister (PDV/caixa)", () => {
    it("findMany sob contexto do Tenant B NUNCA retorna o caixa do Tenant A", async () => {
      const registers = await runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () => prisma.cashRegister.findMany({}));
      expect(registers.find((r) => r.id === cashRegisterAId)).toBeUndefined();
    });

    it("findUnique sob contexto do Tenant B não encontra o caixa do Tenant A", async () => {
      const found = await runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () =>
        prisma.cashRegister.findUnique({ where: { id: cashRegisterAId } }),
      );
      expect(found).toBeNull();
    });

    it("update sob contexto do Tenant B NÃO altera o caixa do Tenant A (ex.: tentativa de fechar o caixa de outro tenant)", async () => {
      await expect(
        runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () =>
          prisma.cashRegister.update({ where: { id: cashRegisterAId }, data: { status: "CLOSED", closingAmount: 0 } }),
        ),
      ).rejects.toBeTruthy();

      const untouched = await prismaUnscoped.cashRegister.findUnique({ where: { id: cashRegisterAId } });
      expect(untouched?.status).toBe("OPEN");
    });

    it("delete sob contexto do Tenant B NÃO apaga o caixa do Tenant A", async () => {
      await expect(
        runWithTenantContext({ tenantId: tenantBId, userId: "n/a", role: "OWNER" }, () => prisma.cashRegister.delete({ where: { id: cashRegisterAId } })),
      ).rejects.toBeTruthy();

      const stillThere = await prismaUnscoped.cashRegister.findUnique({ where: { id: cashRegisterAId } });
      expect(stillThere).not.toBeNull();
    });
  });
});
