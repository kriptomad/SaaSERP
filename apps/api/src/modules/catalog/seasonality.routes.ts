// apps/api/src/modules/catalog/seasonality.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.5 (Papelaria/Presentes) — sazonalidade
// planejada (janelas tipo "Volta às Aulas"/"Natal" associadas a uma categoria de
// produto) e relatório de liquidação de sobras pós-pico.
//
// Reaproveita o model `SeasonalityWindow` (já existia no schema antes desta rodada)
// e as permissões RBAC já seedadas "stock:product:read"/"stock:product:write" (mesmo
// domínio de cadastro de produto/categoria — não introduz código de permissão novo),
// seguindo o mesmo padrão de boilerplate de `liquor-ledger.routes.ts`.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const seasonalityRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

function forbidden(res: Response, message: string) {
  return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message } });
}
function notFound(res: Response, message: string) {
  return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message } });
}
function validationError(res: Response, details: unknown) {
  return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details } });
}

// ─────────────────────────────────────────────────────────────────────────
// CADASTRO DE JANELAS DE SAZONALIDADE
// ─────────────────────────────────────────────────────────────────────────

seasonalityRouter.get("/seasonality-windows", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar janelas de sazonalidade.");
  }
  const windows = await prisma.seasonalityWindow.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return res.json({ success: true, data: windows, error: null });
});

const monthSchema = z.number().int().min(1).max(12);
const daySchema = z.number().int().min(1).max(31);

const createWindowSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().min(1),
  startMonth: monthSchema,
  startDay: daySchema,
  endMonth: monthSchema,
  endDay: daySchema,
  active: z.boolean().optional(),
});

seasonalityRouter.post("/seasonality-windows", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return forbidden(res, "Seu nível de acesso não permite cadastrar janelas de sazonalidade.");
  }
  const parsed = createWindowSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const input = parsed.data;

  const window_ = await prisma.seasonalityWindow.create({
    data: {
      tenantId,
      name: input.name,
      category: input.category,
      startMonth: input.startMonth,
      startDay: input.startDay,
      endMonth: input.endMonth,
      endDay: input.endDay,
      active: input.active ?? true,
    },
  });
  return res.status(201).json({ success: true, data: window_, error: null });
});

const updateWindowSchema = createWindowSchema.partial();

seasonalityRouter.patch("/seasonality-windows/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return forbidden(res, "Seu nível de acesso não permite editar janelas de sazonalidade.");
  }
  const existing = await prisma.seasonalityWindow.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return notFound(res, "Janela de sazonalidade não encontrada.");

  const parsed = updateWindowSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const input = parsed.data;

  const updated = await prisma.seasonalityWindow.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.startMonth !== undefined ? { startMonth: input.startMonth } : {}),
      ...(input.startDay !== undefined ? { startDay: input.startDay } : {}),
      ...(input.endMonth !== undefined ? { endMonth: input.endMonth } : {}),
      ...(input.endDay !== undefined ? { endDay: input.endDay } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// RELATÓRIO DE LIQUIDAÇÃO DE SOBRAS SAZONAIS (Capítulo 11.5, item "Financeiro
// pós-sazonalidade")
//
// HEURÍSTICA ESCOLHIDA (documentada, pragmática — não existe um campo que marque
// "esta unidade de estoque pertence ao pico sazonal X"):
//   1. Para cada SeasonalityWindow ATIVA, calcula-se se a janela "já encerrou este
//      ano" comparando (mês/dia atual) contra (endMonth/endDay), com tratamento de
//      wraparound (janelas que cruzam o ano-novo, ex. out-fev): a janela é
//      considerada "em andamento" se a data atual (mês/dia) estiver entre
//      start e end respeitando o wraparound; só é candidata à liquidação quando
//      JÁ passou do fim mais recente (ver `hasWindowEndedRecently` abaixo).
//   2. Produtos cuja `category` bate com a janela encerrada, com `stockQuantity`
//      acima de `minStockThreshold` (ou acima de 0 quando o produto não tem
//      threshold configurado) E `createdAt` dentro dos últimos 12 meses (proxy de
//      "comprado para este ciclo sazonal", já que não há um campo que vincule
//      diretamente o produto a uma `SeasonalityWindow`) entram no relatório.
//   3. É uma aproximação gerencial — não distingue estoque comprado há vários
//      ciclos sazonais atrás do estoque comprado especificamente para o pico mais
//      recente, mas atende ao objetivo de "evitar capital parado" sem exigir uma
//      nova FK em Product.
function monthDayToOrdinal(month: number, day: number): number {
  return month * 100 + day;
}

// Retorna a data (mês/dia) mais recente em que esta janela terminou, considerando o
// ano corrente ou o ano anterior (quando o fim deste ano ainda não chegou, mas o
// ciclo anterior já tinha terminado) — base da comparação de "janela encerrada".
function mostRecentWindowEnd(now: Date, endMonth: number, endDay: number): Date {
  const candidateThisYear = new Date(now.getFullYear(), endMonth - 1, endDay, 23, 59, 59, 999);
  if (candidateThisYear <= now) return candidateThisYear;
  return new Date(now.getFullYear() - 1, endMonth - 1, endDay, 23, 59, 59, 999);
}

seasonalityRouter.get("/seasonality-windows/clearance-report", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o relatório de liquidação sazonal.");
  }

  const now = new Date();
  const windows = await prisma.seasonalityWindow.findMany({ where: { tenantId, active: true } });
  if (windows.length === 0) {
    return res.json({ success: true, data: [], error: null });
  }

  const categories = [...new Set(windows.map((w) => w.category))];
  const products = await prisma.product.findMany({
    where: { tenantId, active: true, category: { in: categories } },
  });

  const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const rows: Array<{
    productId: string;
    productName: string;
    sku: string;
    category: string;
    stockQuantity: string;
    minStockThreshold: string | null;
    createdAt: Date;
    seasonalityWindowName: string;
    windowEndedAt: Date;
  }> = [];

  for (const window_ of windows) {
    const windowEndedAt = mostRecentWindowEnd(now, window_.endMonth, window_.endDay);
    const matchingProducts = products.filter((p) => p.category === window_.category);
    for (const product of matchingProducts) {
      if (product.createdAt < twelveMonthsAgo) continue; // fora da janela dos últimos 12 meses (heurística acima)
      const threshold = product.minStockThreshold ?? new Prisma.Decimal(0);
      if (!product.stockQuantity.gt(threshold)) continue;
      rows.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        category: product.category ?? "",
        stockQuantity: product.stockQuantity.toString(),
        minStockThreshold: product.minStockThreshold?.toString() ?? null,
        createdAt: product.createdAt,
        seasonalityWindowName: window_.name,
        windowEndedAt,
      });
    }
  }

  rows.sort((a, b) => b.windowEndedAt.getTime() - a.windowEndedAt.getTime());
  return res.json({ success: true, data: rows, error: null });
});
