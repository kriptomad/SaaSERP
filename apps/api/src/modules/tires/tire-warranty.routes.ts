// apps/api/src/modules/tires/tire-warranty.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.10 — Loja de Pneus.
//
// Catálogo técnico (medida, índice de carga/velocidade): NÃO precisa de módulo
// novo — `ProductVariantAxis`/`ProductVariant` (apps/api/src/modules/catalog/
// product-variants.routes.ts) já modelam qualquer grade genérica de atributos
// por produto. Para pneus, basta cadastrar eixos como "Medida" (ex. valores
// "185/65 R15", "195/55 R16") e/ou "Índice de Carga/Velocidade" (ex. "88H") no
// Product do pneu — nenhuma rota nova foi criada para isso, pois já existe.
//
// Garantia de fabricante: `ProductBatch.manufacturerWarrantyMonths` (já
// adicionado centralmente ao schema) é o lote de FABRICAÇÃO do pneu — note que
// `ProductBatch.expirationDate` continua obrigatório (usado pelo FEFO em
// `deduct-stock-fefo.service.ts` para farmácia/mercado) e, para pneus, é
// preenchido pelo fluxo de recebimento de compra com uma data sentinela muito
// distante (ex. receivedAt + 50 anos) — JAMAIS interpretada como validade real
// aqui; só `manufacturerWarrantyMonths` + `receivedAt` definem a garantia.
//
// GAP DE SCHEMA DOCUMENTADO (by-sale-item): `SaleItem` NÃO tem uma FK direta
// para `ProductBatch` (apenas `productVariantId`). A baixa de estoque por lote
// (Capítulo 6.2, `deductStockFefoWithinTx`) grava um `StockMovement` por lote
// consumido com `type = "SALE_OUT"` e `referenceId = <idempotencyKey da Sale>`
// (não o id do SaleItem nem da Sale propriamente — nome do parâmetro
// `saleItemId` em `deduct-stock-fefo.service.ts` é enganoso, mas o valor
// passado por `close-sale.service.ts` é sempre `input.idempotencyKey`, que é
// único por Sale). Esta rota cruza `SaleItem.saleId → Sale.idempotencyKey` e
// busca o `StockMovement` mais antigo (lote de validade mais próxima, ordem
// real do FEFO) daquele produto para aquela venda. LIMITAÇÃO: se a mesma Sale
// tiver DOIS SaleItems do mesmo produto (dois pneus iguais em linhas
// separadas), não há como saber qual item consumiu qual lote — o resultado
// sempre reflete o primeiro lote consumido por aquele produto nessa venda.
// Para o caso comum de pneu (normalmente 1 unidade por lote/linha), isso é
// suficiente; é uma simplificação aceitável e documentada, não um bug oculto.
import { Router, Request, Response } from "express";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const tireWarrantyRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

function forbid(res: Response, message: string) {
  return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message } });
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, data: null, error: { code, message } });
}

async function requireRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "tires:warranty:read"))) {
    forbid(res, "Seu nível de acesso não permite consultar garantia de pneus.");
    return false;
  }
  return true;
}

function warrantyShape(batch: { id: string; receivedAt: Date; manufacturerWarrantyMonths: number | null }) {
  if (batch.manufacturerWarrantyMonths === null) return null;
  const warrantyExpiresAt = new Date(batch.receivedAt);
  warrantyExpiresAt.setMonth(warrantyExpiresAt.getMonth() + batch.manufacturerWarrantyMonths);
  return {
    batchId: batch.id,
    receivedAt: batch.receivedAt,
    manufacturerWarrantyMonths: batch.manufacturerWarrantyMonths,
    warrantyExpiresAt,
    stillUnderWarranty: warrantyExpiresAt.getTime() > Date.now(),
  };
}

tireWarrantyRouter.get("/tire-warranty/check/:productBatchId", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const batch = await prisma.productBatch.findFirst({
    where: { id: req.params.productBatchId, tenantId },
    select: { id: true, receivedAt: true, manufacturerWarrantyMonths: true },
  });
  if (!batch) return fail(res, 404, "NOT_FOUND", "Lote não encontrado.");
  const result = warrantyShape(batch);
  if (!result) return fail(res, 400, "NO_MANUFACTURER_WARRANTY", "Este lote não tem garantia de fabricante cadastrada (não é um lote de pneu).");
  return res.json({ success: true, data: result, error: null });
});

tireWarrantyRouter.get("/tire-warranty/by-sale-item/:saleItemId", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const saleItem = await prisma.saleItem.findFirst({
    where: { id: req.params.saleItemId, tenantId },
    include: { sale: { select: { id: true, idempotencyKey: true, tenantId: true } } },
  });
  if (!saleItem || !saleItem.sale || saleItem.sale.tenantId !== tenantId) return fail(res, 404, "NOT_FOUND", "Item de venda não encontrado.");
  if (!saleItem.productId) return fail(res, 400, "NOT_A_PRODUCT_ITEM", "Este item de venda não é um produto (é um serviço).");

  // Heurística documentada no topo do arquivo: cruza StockMovement(type=SALE_OUT,
  // referenceId=idempotencyKey da Sale, productId do item) com o lote mais antigo
  // (primeiro consumido pelo FEFO) daquele produto nessa venda.
  const movement = await prisma.stockMovement.findFirst({
    where: {
      tenantId,
      productId: saleItem.productId,
      type: "SALE_OUT",
      referenceId: saleItem.sale.idempotencyKey,
      productBatchId: { not: null },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!movement || !movement.productBatchId) {
    return fail(res, 404, "BATCH_NOT_FOUND", "Não foi possível identificar o lote de origem deste item (produto pode não ser rastreado por lote).");
  }
  const batch = await prisma.productBatch.findFirst({
    where: { id: movement.productBatchId, tenantId },
    select: { id: true, receivedAt: true, manufacturerWarrantyMonths: true },
  });
  if (!batch) return fail(res, 404, "NOT_FOUND", "Lote não encontrado.");
  const result = warrantyShape(batch);
  if (!result) return fail(res, 400, "NO_MANUFACTURER_WARRANTY", "O lote de origem deste item não tem garantia de fabricante cadastrada.");
  return res.json({ success: true, data: result, error: null });
});

// Capítulo 11.10 — "Rodízio e inspeção periódica": GAP DE SCHEMA DOCUMENTADO —
// não existe campo para guardar "quilometragem do veículo na última troca de
// pneu" (Vehicle só tem `mileageKm`, o valor ATUAL, sobrescrito a cada
// atualização — não um histórico). Também não há vínculo direto Sale↔Vehicle no
// schema (Sale só tem clientId; Vehicle só tem ownerId → Client). Por isso este
// relatório usa a heurística explicitamente permitida pelo enunciado: (1) liga
// Vehicle→Client via ownerId/clientId, (2) busca a venda mais recente de um
// produto cuja `category` contenha "pneu" (texto livre, sem taxonomia fixa no
// schema) feita por aquele cliente, e (3) sinaliza sugestão de rodízio por TEMPO
// decorrido desde essa venda (não por km rodado, que exigiria o histórico de
// quilometragem que não existe) — ROTATION_SUGGESTION_MONTHS abaixo é o
// intervalo configurável (fabricantes recomendam rodízio a cada 10.000km, que
// equivale a aproximadamente 6-8 meses de uso urbano médio; usamos 6 como
// aproximação conservadora, documentada, não uma regra de negócio exata).
const ROTATION_SUGGESTION_MONTHS = 6;

tireWarrantyRouter.get("/tire-warranty/rotation-suggestions", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;

  const vehicles = await prisma.vehicle.findMany({
    where: { tenantId, mileageKm: { not: null } },
    select: { id: true, licensePlate: true, model: true, mileageKm: true, ownerId: true, owner: { select: { id: true, name: true } } },
  });
  if (vehicles.length === 0) return res.json({ success: true, data: [], error: null });

  const suggestions = await Promise.all(
    vehicles.map(async (vehicle) => {
      const lastTireSaleItem = await prisma.saleItem.findFirst({
        where: {
          tenantId,
          product: { category: { contains: "pneu", mode: "insensitive" } },
          sale: { tenantId, clientId: vehicle.ownerId },
        },
        include: { sale: { select: { id: true, createdAt: true } }, product: { select: { id: true, name: true } } },
        orderBy: { sale: { createdAt: "desc" } },
      });
      if (!lastTireSaleItem) {
        return { vehicleId: vehicle.id, licensePlate: vehicle.licensePlate, model: vehicle.model, owner: vehicle.owner, mileageKm: vehicle.mileageKm, lastTireSale: null, monthsSinceLastTireSale: null, suggestsRotation: false };
      }
      const saleDate = lastTireSaleItem.sale.createdAt;
      const monthsSince = (Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      return {
        vehicleId: vehicle.id,
        licensePlate: vehicle.licensePlate,
        model: vehicle.model,
        owner: vehicle.owner,
        mileageKm: vehicle.mileageKm,
        lastTireSale: { saleId: lastTireSaleItem.sale.id, productName: lastTireSaleItem.product?.name ?? null, soldAt: saleDate },
        monthsSinceLastTireSale: Math.round(monthsSince * 10) / 10,
        suggestsRotation: monthsSince >= ROTATION_SUGGESTION_MONTHS,
      };
    }),
  );

  return res.json({ success: true, data: suggestions.filter((s) => s.lastTireSale !== null), error: null });
});
