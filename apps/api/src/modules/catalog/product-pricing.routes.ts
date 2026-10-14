// apps/api/src/modules/catalog/product-pricing.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.3 — Adega/Bebidas: precificação em
// cascata dinâmica (Preço Unidade / Preço Caixa Fechada / Preço Revenda), selecionada
// automaticamente por quantidade e perfil do cliente. Rota NOVA e somente leitura —
// não edita `products.routes.ts` (arquivo ativo de outro fluxo) nem
// `catalog/product-variants.routes.ts`.
//
// Regra de seleção (ordem de prioridade):
//   1. Cliente revendedor (`Client.isReseller=true`) com `Product.resalePrice`
//      cadastrado → Preço Revenda, independente da quantidade.
//   2. `quantity >= Product.wholesaleMinQty` com `Product.wholesalePrice`
//      cadastrado → Preço Caixa Fechada (atacado).
//   3. Caso contrário → Preço Unidade (`Product.unitPrice`).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const productPricingRouter = Router();

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

const querySchema = z.object({
  quantity: z.coerce.number().positive().default(1),
  clientId: z.string().uuid().optional(),
});

productPricingRouter.get("/products/:id/price-for-quantity", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar preços de produto.");
  }
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { quantity, clientId } = parsed.data;

  const product = await prisma.product.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, name: true, unitPrice: true, wholesalePrice: true, wholesaleMinQty: true, resalePrice: true },
  });
  if (!product) return notFound(res, "Produto não encontrado.");

  let client: { id: string; isReseller: boolean } | null = null;
  if (clientId) {
    client = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true, isReseller: true } });
    if (!client) return notFound(res, "Cliente não encontrado.");
  }

  let tier: "RESALE" | "WHOLESALE" | "UNIT";
  let unitPrice: number;

  if (client?.isReseller && product.resalePrice !== null) {
    tier = "RESALE";
    unitPrice = Number(product.resalePrice);
  } else if (product.wholesaleMinQty !== null && product.wholesalePrice !== null && quantity >= product.wholesaleMinQty) {
    tier = "WHOLESALE";
    unitPrice = Number(product.wholesalePrice);
  } else {
    tier = "UNIT";
    unitPrice = Number(product.unitPrice);
  }

  return res.json({
    success: true,
    data: {
      productId: product.id,
      productName: product.name,
      quantity,
      tier,
      unitPrice,
      totalPrice: Number((unitPrice * quantity).toFixed(2)),
      availablePrices: {
        unitPrice: Number(product.unitPrice),
        wholesalePrice: product.wholesalePrice !== null ? Number(product.wholesalePrice) : null,
        wholesaleMinQty: product.wholesaleMinQty,
        resalePrice: product.resalePrice !== null ? Number(product.resalePrice) : null,
      },
    },
    error: null,
  });
});
