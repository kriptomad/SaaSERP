// apps/api/src/modules/construction/construction-quotes.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.8 — Material de Construção/Ferragens:
// "orçamento de obra" (quote de múltiplos itens, validade de dias/semanas, SEM
// caixa/forma de pagamento definida ainda).
//
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 3): o nicho só tinha faturamento
// mensal de conta profissional (business-accounts.routes.ts) — faltava o
// orçamento de obra em si. `ConstructionQuote`/`ConstructionQuoteItem` são
// modelos NOVOS e dedicados (não reaproveitam `Sale`, que sempre exige
// `cashRegisterId`/`cashierId`/`paymentMethod` de uma venda já fechada no PDV —
// ver comentário no schema.prisma). A transição CONVERTED é só textual: o
// operador lança a venda real no PDV referenciando o número do orçamento; este
// endpoint NUNCA cria uma `Sale` sozinho, para não duplicar a responsabilidade
// de fechamento de caixa (close-sale.service.ts, arquivo restrito).
//
// Permissão: reaproveita "stock:product:read"/"stock:product:write", mesmo
// domínio RBAC já usado por business-accounts.routes.ts neste nicho.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";
import { zodDecimal } from "../../lib/zod-decimal";
import { readEnumQuery } from "../../lib/query-enum";

export const constructionQuotesRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, data: null, error: { code, message } });
}
async function requireRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite consultar orçamentos de obra.");
    return false;
  }
  return true;
}
async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite criar/atualizar orçamentos de obra.");
    return false;
  }
  return true;
}

const itemSchema = z.object({
  productId: z.string().min(1).nullable().optional(),
  description: z.string().min(1),
  // CORREÇÃO DE AUDITORIA: `z.coerce.number()` convertia quantidade/preço do
  // client para `number` (float) antes de chegar às colunas
  // `@db.Decimal(12,3)`/`@db.Decimal(12,2)` — trocado por `zodDecimal` para
  // preservar a precisão exata do valor informado.
  quantity: zodDecimal({ positive: true }),
  unit: z.string().min(1),
  unitPrice: zodDecimal(),
});

const createSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1),
  validUntil: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
});

constructionQuotesRouter.post("/construction-quotes", requireAuth, requireModule("CONSTRUCTION_BULK_UNITS"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", parsed.error.message);
  const { tenantId } = req.session!;
  const input = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: input.clientId, tenantId } });
  if (!client) return fail(res, 404, "NOT_FOUND", "Cliente não encontrado.");

  // CORREÇÃO DE AUDITORIA: `productId` dos itens chegava do client sem
  // nenhuma validação de pertencimento ao tenant — um orçamento poderia
  // referenciar um produto de OUTRO tenant (vazamento de referência
  // cross-tenant), mesmo que o item em si não dependa de `Product` para
  // existir (campo opcional).
  const productIds = [...new Set(input.items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  if (productIds.length > 0) {
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, tenantId }, select: { id: true } });
    const foundIds = new Set(products.map((p) => p.id));
    const missing = productIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return fail(res, 404, "NOT_FOUND", `Produto(s) não encontrado(s) neste tenant: ${missing.join(", ")}.`);
    }
  }

  const quote = await prisma.constructionQuote.create({
    data: {
      tenantId,
      clientId: input.clientId,
      title: input.title,
      validUntil: input.validUntil ?? null,
      notes: input.notes ?? null,
      items: {
        create: input.items.map((item) => ({
          tenantId,
          productId: item.productId ?? null,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
        })),
      },
    },
    include: { items: true, client: { select: { id: true, name: true, phone: true } } },
  });
  return res.status(201).json({ success: true, data: quote, error: null });
});

constructionQuotesRouter.get("/construction-quotes", requireAuth, requireModule("CONSTRUCTION_BULK_UNITS"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const statusParsed = readEnumQuery(res, req.query.status, ["DRAFT", "SENT", "APPROVED", "REJECTED", "CONVERTED", "EXPIRED"] as const, "status");
  if (!statusParsed.ok) return;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const quotes = await prisma.constructionQuote.findMany({
    where: { tenantId, ...(statusParsed.value ? { status: statusParsed.value } : {}), ...(clientId ? { clientId } : {}) },
    include: { items: true, client: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json({ success: true, data: quotes, error: null });
});

constructionQuotesRouter.get("/construction-quotes/:id", requireAuth, requireModule("CONSTRUCTION_BULK_UNITS"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const quote = await prisma.constructionQuote.findFirst({
    where: { id: req.params.id, tenantId },
    include: { items: true, client: { select: { id: true, name: true, phone: true } } },
  });
  if (!quote) return fail(res, 404, "NOT_FOUND", "Orçamento de obra não encontrado.");
  return res.json({ success: true, data: quote, error: null });
});

const statusSchema = z.object({ status: z.enum(["SENT", "APPROVED", "REJECTED", "CONVERTED", "EXPIRED"]) });

// Transições válidas (fail-closed — nunca permite pular etapas arbitrariamente):
// DRAFT→SENT→APPROVED→CONVERTED, ou →REJECTED/→EXPIRED a partir de SENT/APPROVED.
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SENT"],
  SENT: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["CONVERTED", "EXPIRED"],
  REJECTED: [],
  CONVERTED: [],
  EXPIRED: [],
};

constructionQuotesRouter.patch("/construction-quotes/:id/status", requireAuth, requireModule("CONSTRUCTION_BULK_UNITS"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", parsed.error.message);
  const { tenantId } = req.session!;
  const existing = await prisma.constructionQuote.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return fail(res, 404, "NOT_FOUND", "Orçamento de obra não encontrado.");

  const allowed = VALID_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(parsed.data.status)) {
    return fail(res, 409, "INVALID_TRANSITION", `Não é possível mudar de ${existing.status} para ${parsed.data.status}.`);
  }

  const updated = await prisma.constructionQuote.update({ where: { id: existing.id }, data: { status: parsed.data.status } });
  return res.json({ success: true, data: updated, error: null });
});
