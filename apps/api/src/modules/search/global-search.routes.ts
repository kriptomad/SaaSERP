// apps/api/src/modules/search/global-search.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — busca global (Ctrl+K).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: nenhuma rota de busca cross-entity
// existia; o Ctrl+K nunca teve de onde buscar dados reais além da navegação
// estática do frontend. Busca por prefixo/substring (ILIKE) em até 5 produtos,
// 5 clientes, 5 ordens de serviço e 5 fornecedores — suficiente para "achar
// rápido" sem virar um motor de busca full-text (fora de escopo desta 1ª
// implementação).
import { Router, Request, Response } from "express";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const globalSearchRouter = Router();

export interface SearchResultItem {
  type: "PRODUCT" | "CLIENT" | "WORK_ORDER" | "SUPPLIER";
  id: string;
  label: string;
  subtitle: string;
  route: string;
}

globalSearchRouter.get("/search", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const term = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (term.length < 2) {
    return res.json({ success: true, data: [], error: null });
  }

  const [products, clients, workOrders, suppliers] = await Promise.all([
    prisma.product.findMany({
      where: {
        tenantId,
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { sku: { contains: term, mode: "insensitive" } },
          { barcode: { contains: term, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, sku: true },
      take: 5,
    }),
    prisma.client.findMany({
      where: {
        tenantId,
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { document: { contains: term, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, document: true },
      take: 5,
    }),
    prisma.workOrder.findMany({
      where: {
        tenantId,
        OR: [
          { equipmentDescription: { contains: term, mode: "insensitive" } },
          { reportedIssue: { contains: term, mode: "insensitive" } },
        ],
      },
      select: { id: true, equipmentDescription: true, status: true },
      take: 5,
    }),
    prisma.supplier.findMany({
      where: {
        tenantId,
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { document: { contains: term, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, document: true },
      take: 5,
    }),
  ]);

  const results: SearchResultItem[] = [
    ...products.map((p): SearchResultItem => ({ type: "PRODUCT", id: p.id, label: p.name, subtitle: `SKU ${p.sku}`, route: "/cadastros/produtos" })),
    ...clients.map((c): SearchResultItem => ({ type: "CLIENT", id: c.id, label: c.name, subtitle: c.document ?? "", route: "/cadastros/clientes" })),
    ...workOrders.map((w): SearchResultItem => ({
      type: "WORK_ORDER",
      id: w.id,
      label: w.equipmentDescription,
      subtitle: `O.S. — ${w.status}`,
      route: `/os/${w.id}`,
    })),
    ...suppliers.map((s): SearchResultItem => ({ type: "SUPPLIER", id: s.id, label: s.name, subtitle: s.document ?? "", route: "/cadastros/fornecedores" })),
  ];

  return res.json({ success: true, data: results, error: null });
});
