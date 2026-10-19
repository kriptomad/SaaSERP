// apps/api/src/modules/purchasing/nfe-xml-import.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.8 — rotas REST do import de XML de
// NF-e de compra (ver nfe-xml-import.service.ts para o racional completo).
// Fluxo em 2 passos (nunca grava nada no passo 1 — é só leitura/casamento):
//   1. POST /purchase-orders/import-nfe/preview — recebe o XML cru, devolve os
//      itens já casados com o catálogo para o lojista revisar/ajustar na tela.
//   2. POST /purchase-orders/import-nfe/confirm — recebe a mesma XML + os ajustes
//      manuais do lojista (productId escolhido para itens sem casamento automático)
//      e cria um PurchaseOrder real (status SENT, pronto para o fluxo de
//      recebimento já existente em POST /purchase-orders/:id/receive — nunca
//      duplicamos a lógica de baixa de estoque/custo médio, que já vive lá).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { parseNfeXml, matchNfeItemsToCatalog, findSupplierByDocument, InvalidNfeXmlError } from "./nfe-xml-import.service";
import { isFeatureEnabled } from "../../lib/feature-flags";
import { createModuleLogger } from "../../lib/logger";

const logger = createModuleLogger("nfe-xml-import");

// Rollout progressivo (Capítulo 15.2) — feature nova (ver nfe-xml-import.service.ts),
// liberada por padrão para tenants cadastrados pelo painel admin em
// FeatureFlag.enabledForTenantIds durante o beta, depois ampliada via
// `rolloutPercent` sem precisar de novo deploy.
const NFE_XML_IMPORT_FLAG = "NFE_XML_IMPORT";

export const nfeXmlImportRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

async function requireStockWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite importar notas de compra." } });
    return false;
  }
  return true;
}

const previewSchema = z.object({ xml: z.string().min(1) });

nfeXmlImportRouter.post("/purchase-orders/import-nfe/preview", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  if (!(await isFeatureEnabled(NFE_XML_IMPORT_FLAG, req.session!.tenantId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FEATURE_NOT_ENABLED", message: "O import de XML de NF-e ainda não está disponível para este tenant." } });
  }
  const parsedBody = previewSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsedBody.error.message } });
  }

  let parsedNfe;
  try {
    parsedNfe = parseNfeXml(parsedBody.data.xml);
  } catch (error) {
    if (error instanceof InvalidNfeXmlError) {
      return res.status(422).json({ success: false, data: null, error: { code: "INVALID_NFE_XML", message: error.message } });
    }
    throw error;
  }

  const [matched, supplierMatch] = await Promise.all([
    matchNfeItemsToCatalog(prisma, parsedNfe),
    findSupplierByDocument(prisma, parsedNfe.supplier.cnpj),
  ]);

  return res.json({
    success: true,
    data: {
      ...matched,
      supplierMatch, // { id, name } do Supplier já cadastrado, ou null — front decide se cria um novo
    },
    error: null,
  });
});

const confirmItemSchema = z.object({
  cProd: z.string(),
  productId: z.string(), // obrigatório aqui: todo item precisa estar vinculado a um produto do catálogo antes da confirmação (criado manualmente pelo lojista se não houver casamento automático)
  quantity: z.number().positive(),
  unitCost: z.number().positive(),
});

const confirmSchema = z.object({
  xml: z.string().min(1), // XML original — revalidado aqui contra os valores editados pelo lojista (nunca confiamos apenas no que o front reenvia como "items")
  supplierId: z.string(),
  dueDate: z.coerce.date().optional(),
  items: z.array(confirmItemSchema).min(1),
});

// Tolerância de arredondamento para considerar quantidade/custo "iguais" ao XML
// (centavos de diferença por conversão float<->string no front não devem disparar
// alerta de divergência, mas qualquer coisa além disso é registrada em log de
// auditoria para investigação — o lojista pode legitimamente ajustar valores
// (ex.: desconto comercial não refletido na nota), mas a divergência nunca deve
// passar silenciosa).
const DIVERGENCE_TOLERANCE = 0.01;

function logConfirmDivergences(tenantId: string, userId: string, parsedItems: ReturnType<typeof parseNfeXml>["items"], confirmedItems: z.infer<typeof confirmItemSchema>[]) {
  const parsedByCProd = new Map(parsedItems.map((item) => [item.cProd, item]));
  for (const confirmed of confirmedItems) {
    const original = parsedByCProd.get(confirmed.cProd);
    if (!original) {
      logger.warn({ tenantId, userId, cProd: confirmed.cProd }, "Import de NF-e confirmado com item (cProd) ausente no XML original enviado no preview — possível XML divergente entre preview e confirm.");
      continue;
    }
    const qtyDiff = Math.abs(confirmed.quantity - Number(original.quantity));
    const costDiff = Math.abs(confirmed.unitCost - Number(original.unitCost));
    if (qtyDiff > DIVERGENCE_TOLERANCE || costDiff > DIVERGENCE_TOLERANCE) {
      logger.warn(
        {
          tenantId,
          userId,
          cProd: confirmed.cProd,
          xmlQuantity: original.quantity.toString(),
          confirmedQuantity: confirmed.quantity,
          xmlUnitCost: original.unitCost.toString(),
          confirmedUnitCost: confirmed.unitCost,
        },
        "Divergência entre quantidade/custo do XML original e valores confirmados no import de NF-e — auditar antes de considerar fraude/erro de digitação.",
      );
    }
  }
}

nfeXmlImportRouter.post("/purchase-orders/import-nfe/confirm", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  if (!(await isFeatureEnabled(NFE_XML_IMPORT_FLAG, req.session!.tenantId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FEATURE_NOT_ENABLED", message: "O import de XML de NF-e ainda não está disponível para este tenant." } });
  }
  const parsedBody = confirmSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsedBody.error.message } });
  }
  const { userId, tenantId } = req.session!;
  const { xml, supplierId, items } = parsedBody.data;

  // Revalida os valores editados pelo lojista contra o XML original (nunca confia
  // apenas no payload "items" reenviado pelo front) — reinterpreta o mesmo XML cru
  // já usado no preview e registra em log de auditoria qualquer divergência de
  // quantidade/custo entre o que a NF-e realmente diz e o que foi confirmado
  // (CORREÇÃO DE AUDITORIA: antes não havia nenhuma revalidação nesta etapa).
  let parsedNfeForConfirm;
  try {
    parsedNfeForConfirm = parseNfeXml(xml);
  } catch (error) {
    if (error instanceof InvalidNfeXmlError) {
      return res.status(422).json({ success: false, data: null, error: { code: "INVALID_NFE_XML", message: error.message } });
    }
    throw error;
  }
  logConfirmDivergences(tenantId, userId, parsedNfeForConfirm.items, items);

  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, tenantId }, select: { id: true } });
  if (!supplier) {
    return res.status(404).json({ success: false, data: null, error: { code: "SUPPLIER_NOT_FOUND", message: "Fornecedor não encontrado neste tenant." } });
  }
  const productIds = [...new Set(items.map((i) => i.productId))];
  const ownedProducts = await prisma.product.count({ where: { id: { in: productIds }, tenantId } });
  if (ownedProducts !== productIds.length) {
    return res.status(404).json({ success: false, data: null, error: { code: "PRODUCT_NOT_FOUND", message: "Um ou mais produtos selecionados não pertencem a este tenant." } });
  }

  const order = await prisma.$transaction(async (tx) => {
    // Mesmo esquema de numeração sequencial de purchase-orders.routes.ts — nunca
    // duplicado em uma função compartilhada para não criar acoplamento entre rotas
    // que evoluem de forma independente, mas a regra ("nunca reaproveitar número
    // mesmo após cancelamento") é a mesma. CORREÇÃO DE AUDITORIA: a numeração
    // precisa ser escopada por tenant — sem o filtro, o último número considerado
    // era o último de QUALQUER tenant, gerando colisão/pulo de numeração.
    const lastOrder = await tx.purchaseOrder.findFirst({ where: { tenantId }, orderBy: { orderNumber: "desc" }, select: { orderNumber: true } });
    const orderNumber = (lastOrder?.orderNumber ?? 0) + 1;
    return tx.purchaseOrder.create({
      data: {
        tenantId,
        supplierId,
        orderNumber,
        status: "SENT", // já nasce SENT (não DRAFT): a nota já foi emitida pelo fornecedor, então o pedido já está, na prática, confirmado — pronto direto para o fluxo de recebimento
        notes: "Importado automaticamente de XML de NF-e de compra.",
        createdById: userId,
        items: { create: items.map((i) => ({ tenantId, productId: i.productId, quantityOrdered: i.quantity, unitCost: i.unitCost })) },
      },
      include: { items: true },
    });
  }, { isolationLevel: "Serializable" });

  return res.status(201).json({ success: true, data: order, error: null });
});
