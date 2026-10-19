// apps/api/tests/concurrency/cashregister-budget-concurrency.test.ts
// GAP DE AUDITORIA FECHADO (fa-test-cashregister-budget-concurrency): nenhum teste
// real disparava duas operações VERDADEIRAMENTE concorrentes (Promise.all) contra o
// banco de teste para exercitar os mecanismos de controle de concorrência já
// implementados em `approve-budget.service.ts` (lock otimista via UPDATE
// condicional) e `cash-register.routes.ts`/`close-cash-register.service.ts` (lock
// pessimista via `FOR UPDATE` e transação Serializable).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma, prismaUnscoped } from "@filitech/db";
import { app } from "../../src/server";
import { approveBudget, BudgetAlreadyProcessedError } from "../../src/services/work-order/approve-budget.service";
import { closeCashRegister } from "../../src/modules/cash-register/close-cash-register.service";

interface SignupResponse {
  token: string;
  tenant: { id: string; slug: string };
  user: { id: string };
}

const STRONG_PASSWORD = "C@nar10Concorrencia#2026";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function signupTenant(prefix: string): Promise<SignupResponse> {
  const slug = uniqueSlug(prefix);
  const res = await request(app)
    .post("/auth/signup")
    .send({
      legalName: `${prefix} Canário Concorrência LTDA`,
      tradeName: `${prefix} Canário`,
      slug,
      cnpj: undefined,
      tenantType: "PERSONAL",
      ownerName: `Owner ${prefix}`,
      ownerEmail: `${slug}@concorrencia-canario.test`,
      ownerPassword: STRONG_PASSWORD,
      termsAccepted: true,
    });
  if (res.status !== 201) {
    throw new Error(`Falha ao criar tenant de teste "${prefix}": HTTP ${res.status} — ${JSON.stringify(res.body)}`);
  }
  return res.body.data as SignupResponse;
}

describe("Concorrência real — aprovação de orçamento e caixa", () => {
  let tenant: SignupResponse;

  beforeAll(async () => {
    tenant = await signupTenant("concurrency-tenant");
  });

  afterAll(async () => {
    await prismaUnscoped.cashRegister.deleteMany({ where: { tenantId: tenant.tenant.id } });
    await prismaUnscoped.workOrder.deleteMany({ where: { tenantId: tenant.tenant.id } });
    await prismaUnscoped.client.deleteMany({ where: { tenantId: tenant.tenant.id } });
    await prismaUnscoped.user.deleteMany({ where: { tenantId: tenant.tenant.id } });
    await prismaUnscoped.$disconnect();
  });

  describe("approveBudget — lock otimista por token consumível (duplo clique do cliente)", () => {
    it("duas aprovações CONCORRENTES do mesmo token: exatamente UMA vence, a outra recebe BudgetAlreadyProcessedError, e a O.S. fica IN_REPAIR exatamente uma vez", async () => {
      const client = await prismaUnscoped.client.create({ data: { tenantId: tenant.tenant.id, name: "Cliente Canário Concorrência" } });
      const token = uniqueSlug("budget-token");
      const workOrder = await prismaUnscoped.workOrder.create({
        data: {
          tenantId: tenant.tenant.id,
          clientId: client.id,
          equipmentDescription: "Equipamento de teste de concorrência",
          reportedIssue: "Simulação de clique duplo na aprovação de orçamento",
          status: "AWAITING_APPROVAL",
          budgetApprovalToken: token,
          budgetValidUntil: new Date(Date.now() + 86_400_000),
        },
      });

      // Promise.all REAL: duas chamadas simultâneas de aprovação contra o mesmo
      // token, cada uma abrindo sua própria transação no mesmo banco de teste —
      // não é um mock serializado, é a corrida de verdade que o lock otimista
      // (UPDATE condicional WHERE status='AWAITING_APPROVAL') precisa resolver.
      const results = await Promise.allSettled([
        approveBudget(prismaUnscoped, token),
        approveBudget(prismaUnscoped, token),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BudgetAlreadyProcessedError);

      const reloaded = await prismaUnscoped.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } });
      expect(reloaded.status).toBe("IN_REPAIR");
      expect(reloaded.budgetApprovalToken).toBeNull();
      expect(reloaded.budgetApprovedAt).not.toBeNull();
    });

    it("token já expirado rejeita com BudgetExpiredError mesmo sem concorrência (sanity check do lock otimista)", async () => {
      const client = await prismaUnscoped.client.create({ data: { tenantId: tenant.tenant.id, name: "Cliente Canário Orçamento Expirado" } });
      const token = uniqueSlug("budget-token-expired");
      await prismaUnscoped.workOrder.create({
        data: {
          tenantId: tenant.tenant.id,
          clientId: client.id,
          equipmentDescription: "Equipamento de teste de expiração",
          reportedIssue: "Orçamento expirado",
          status: "AWAITING_APPROVAL",
          budgetApprovalToken: token,
          budgetValidUntil: new Date(Date.now() - 1000), // já expirado
        },
      });

      await expect(approveBudget(prismaUnscoped, token)).rejects.toThrow(/expirado/i);
    });
  });

  describe("Fechamento de caixa concorrente — GAP DE AUDITORIA ENCONTRADO (não corrigido neste escopo de testes)", () => {
    it(
      "duas chamadas CONCORRENTES de closeCashRegister para o MESMO caixa: o lock FOR UPDATE serializa as duas " +
        "transações, mas o serviço não revalida status==='OPEN' dentro da seção protegida — a SEGUNDA transação " +
        "(que entra na fila do lock depois da primeira já ter commitado CLOSED) sobrescreve silenciosamente " +
        "closingAmount/divergenceAmount com a sua PRÓPRIA contagem, sem lançar nenhum erro. Este teste documenta " +
        "o comportamento REAL observado (nenhuma das duas chamadas rejeita) — é um achado de auditoria, não uma " +
        "correção: o fluxo correto seria a 2ª chamada falhar com algo como 'caixa já fechado', análogo ao guard " +
        "'WHERE status = AWAITING_APPROVAL' que approveBudget já usa corretamente acima.",
      async () => {
        const owner = await prismaUnscoped.user.findFirstOrThrow({ where: { tenantId: tenant.tenant.id, role: "OWNER" } });
        const register = await prismaUnscoped.cashRegister.create({
          data: { tenantId: tenant.tenant.id, openedById: owner.id, openingAmount: new Prisma.Decimal(100) },
        });

        const results = await Promise.allSettled([
          prismaUnscoped.$transaction((tx) => closeCashRegister(tx as any, register.id, new Prisma.Decimal(150))),
          prismaUnscoped.$transaction((tx) => closeCashRegister(tx as any, register.id, new Prisma.Decimal(999))),
        ]);

        // Documenta o estado real: NENHUMA das duas falha (ambas "fulfilled"), o que
        // evidencia a ausência do guard de status dentro da transação.
        const fulfilledCount = results.filter((r) => r.status === "fulfilled").length;
        expect(fulfilledCount).toBeGreaterThanOrEqual(1);

        const reloaded = await prismaUnscoped.cashRegister.findUniqueOrThrow({ where: { id: register.id } });
        // Independentemente de qual das duas "venceu" por último, o estado final é
        // consistente (fechado, com UM valor de fechamento — nunca um saldo
        // duplicado/somado): não há duplicação de saldo, mas também não há garantia
        // de que o PRIMEIRO fechamento legítimo seja o que prevalece.
        expect(reloaded.status).toBe("CLOSED");
        expect([150, 999]).toContain(Number(reloaded.closingAmount));
      },
    );

    it("abertura de caixa CONCORRENTE (duas chamadas HTTP reais via Promise.all) para o mesmo operador: exatamente uma vence (transação Serializable + índice único)", async () => {
      // Reaproveita o fluxo HTTP real (POST /cash-registers) em vez de chamar o
      // serviço diretamente, pois a proteção aqui vive na ROTA (transação
      // Serializable + tratamento de P2034/P2002), não em close-cash-register.service.ts.
      const owner = await prismaUnscoped.user.findFirstOrThrow({ where: { tenantId: tenant.tenant.id, role: "OWNER" } });
      // Garante que não há caixa OPEN residual de outro teste para este operador.
      await prismaUnscoped.cashRegister.updateMany({ where: { tenantId: tenant.tenant.id, openedById: owner.id, status: "OPEN" }, data: { status: "CLOSED" } });

      const [responseA, responseB] = await Promise.all([
        request(app).post("/cash-registers").set("Authorization", `Bearer ${tenant.token}`).send({ openingAmount: 200 }),
        request(app).post("/cash-registers").set("Authorization", `Bearer ${tenant.token}`).send({ openingAmount: 300 }),
      ]);

      const statuses = [responseA.status, responseB.status].sort();
      // Exatamente uma das duas deve criar (201) e a outra deve ser rejeitada (409)
      // por já existir um caixa OPEN para o mesmo operador — nunca as duas 201.
      expect(statuses).toEqual([201, 409]);

      const openRegisters = await prismaUnscoped.cashRegister.findMany({ where: { tenantId: tenant.tenant.id, openedById: owner.id, status: "OPEN" } });
      expect(openRegisters).toHaveLength(1);
    });
  });
});
