// apps/api/src/modules/multi-filial/multi-filial.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 1.2.5 (Fase 5 — Expansão Multi-Filial) e
// Capítulo 2.3 (módulo pago `MULTI_FILIAL`, R$59,90/mês): "Tenants podem ser
// organizados em hierarquia `parentTenantId`, permitindo que o dono de uma rede de
// duas ou três lojas veja um dashboard consolidado sem perder o isolamento
// transacional de cada unidade".
// GAP DE AUDITORIA FECHADO (nicho `multi-filial`): o módulo já existia no catálogo de
// vendas (`content/catalog.ts`) e o schema já tinha `Tenant.parentTenantId`/
// `childTenants` desde o início, mas NENHUMA rota lia essa hierarquia — um lojista
// que pagasse pelo módulo não tinha absolutamente nenhuma tela/endpoint a mais do
// que sem ele. Esta é a 1ª implementação real.
//
// Modelo de autorização (mesmo princípio de `assertAccountingAccess()` em
// accounting-office.routes.ts): só a MATRIZ (tenant com `parentTenantId = null` e
// pelo menos uma filial) pode consultar o consolidado, e ela só pode agregar dados de
// tenants que estejam literalmente listados em `childTenants` — nunca um `tenantId`
// arbitrário recebido do cliente. Uma filial (tenant com `parentTenantId` preenchido)
// jamais acessa o consolidado da rede, apenas sua própria operação normal.
//
// Isolamento transacional preservado: cada métrica é somada por uma query agregada
// SEPARADA por filial (nunca um `WHERE tenantId IN (...)` que mistura linhas de
// tenants diferentes em uma única soma sem rastreabilidade) — por isso usamos
// `prismaUnscoped` (contornando deliberadamente a extensão de tenant único da sessão,
// Capítulo 7) com `tenantId` explícito em cada agregação, nunca uma leitura
// cross-tenant "solta".
import { Router, Request, Response } from "express";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";

export const multiFilialRouter = Router();

async function resolveMatrizOrRespond(
  req: Request,
  res: Response,
): Promise<{ matrizTenantId: string; branchTenantIds: string[] } | null> {
  const { tenantId } = req.session!;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, parentTenantId: true, childTenants: { select: { id: true } } },
  });
  if (!tenant) {
    res.status(404).json({ success: false, data: null, error: { code: "TENANT_NOT_FOUND", message: "Tenant não encontrado." } });
    return null;
  }
  if (tenant.parentTenantId) {
    res.status(403).json({
      success: false,
      data: null,
      error: { code: "NOT_MATRIZ", message: "Esta unidade é uma filial — o dashboard consolidado só é visível pela matriz da rede." },
    });
    return null;
  }
  if (tenant.childTenants.length === 0) {
    res.status(409).json({
      success: false,
      data: null,
      error: { code: "NO_BRANCHES", message: "Nenhuma filial vinculada ainda. Cadastre filiais apontando parentTenantId para esta matriz (suporte via onboarding/CS)." },
    });
    return null;
  }
  return { matrizTenantId: tenant.id, branchTenantIds: tenant.childTenants.map((c) => c.id) };
}

// ─────────────────────────────────────────────────────────────────────────
// GET /multi-filial/branches — lista a matriz + filiais (para seletor de UI)
// ─────────────────────────────────────────────────────────────────────────
multiFilialRouter.get("/multi-filial/branches", requireAuth, requireModule("MULTI_FILIAL"), async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      tradeName: true,
      slug: true,
      status: true,
      uf: true,
      parentTenantId: true,
      childTenants: { select: { id: true, tradeName: true, slug: true, status: true, uf: true }, orderBy: { tradeName: "asc" } },
    },
  });
  if (!tenant) {
    return res.status(404).json({ success: false, data: null, error: { code: "TENANT_NOT_FOUND", message: "Tenant não encontrado." } });
  }
  if (tenant.parentTenantId) {
    return res.status(403).json({
      success: false,
      data: null,
      error: { code: "NOT_MATRIZ", message: "Esta unidade é uma filial — o dashboard consolidado só é visível pela matriz da rede." },
    });
  }

  return res.json({
    success: true,
    data: {
      matriz: { id: tenant.id, tradeName: tenant.tradeName, slug: tenant.slug, status: tenant.status, uf: tenant.uf },
      branches: tenant.childTenants,
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /multi-filial/dashboard — consolidado real (vendas hoje/mês, caixas abertos,
// estoque baixo) por filial + totais somados pela matriz.
// ─────────────────────────────────────────────────────────────────────────
multiFilialRouter.get("/multi-filial/dashboard", requireAuth, requireModule("MULTI_FILIAL"), async (req: Request, res: Response) => {
  const resolved = await resolveMatrizOrRespond(req, res);
  if (!resolved) return;
  const { matrizTenantId, branchTenantIds } = resolved;
  const allTenantIds = [matrizTenantId, ...branchTenantIds];

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Uma consulta agregada POR tenant (nunca `IN (...)` misturado), para que cada
  // linha do consolidado seja rastreável à sua própria unidade — ver cabeçalho.
  // `lowStockCandidates` compara `stockQuantity <= minStockThreshold` em memória (não
  // em SQL) porque o Prisma Client não suporta comparar duas colunas diretamente num
  // `where` sem `$queryRaw`; aceitável pois o universo com limiar configurado por loja
  // é pequeno (curadoria manual do lojista). PENDENTE (otimização futura): `$queryRaw`
  // se o volume crescer muito.
  const perBranch = await Promise.all(
    allTenantIds.map(async (tid) => {
      const [tenant, salesToday, salesMonth, openCashRegisters, lowStockCandidates] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tid }, select: { id: true, tradeName: true, slug: true, status: true, uf: true } }),
        prisma.sale.aggregate({
          where: { tenantId: tid, status: "PAID", createdAt: { gte: startOfToday } },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        prisma.sale.aggregate({
          where: { tenantId: tid, status: "PAID", createdAt: { gte: startOfMonth } },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        prisma.cashRegister.count({ where: { tenantId: tid, status: "OPEN" } }),
        prisma.product.findMany({
          where: { tenantId: tid, minStockThreshold: { not: null } },
          select: { stockQuantity: true, minStockThreshold: true },
        }),
      ]);

      const lowStockProductsCount = lowStockCandidates.filter(
        (p) => p.minStockThreshold != null && Number(p.stockQuantity) <= Number(p.minStockThreshold),
      ).length;

      return {
        tenantId: tid,
        tradeName: tenant?.tradeName ?? "—",
        slug: tenant?.slug ?? "",
        status: tenant?.status ?? "UNKNOWN",
        uf: tenant?.uf ?? null,
        isMatriz: tid === matrizTenantId,
        salesToday: { count: salesToday._count._all, total: Number(salesToday._sum.totalAmount ?? 0) },
        salesMonth: { count: salesMonth._count._all, total: Number(salesMonth._sum.totalAmount ?? 0) },
        openCashRegisters,
        lowStockProductsCount,
      };
    }),
  );

  const totals = perBranch.reduce(
    (acc, b) => ({
      salesTodayCount: acc.salesTodayCount + b.salesToday.count,
      salesTodayTotal: acc.salesTodayTotal + b.salesToday.total,
      salesMonthCount: acc.salesMonthCount + b.salesMonth.count,
      salesMonthTotal: acc.salesMonthTotal + b.salesMonth.total,
      openCashRegisters: acc.openCashRegisters + b.openCashRegisters,
      lowStockProductsCount: acc.lowStockProductsCount + b.lowStockProductsCount,
    }),
    { salesTodayCount: 0, salesTodayTotal: 0, salesMonthCount: 0, salesMonthTotal: 0, openCashRegisters: 0, lowStockProductsCount: 0 },
  );

  return res.json({ success: true, data: { branches: perBranch, totals }, error: null });
});
