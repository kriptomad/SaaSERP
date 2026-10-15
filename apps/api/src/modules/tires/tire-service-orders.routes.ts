// apps/api/src/modules/tires/tire-service-orders.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.10 — Loja de Pneus.
//
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 3): o nicho só tinha consulta de
// garantia (tire-warranty.routes.ts) — faltava a operação REAL de borracharia,
// ou seja, a própria O.S. de montagem/balanceamento/alinhamento. Este router
// companheiro segue o MESMO padrão já estabelecido por
// optical-lab-work-orders.routes.ts: opera sobre o model `WorkOrder` do Prisma,
// filtrado por `workOrderType = TIRE_SHOP`, reaproveitando TODA a infraestrutura
// genérica já existente (WorkOrderItem para mão de obra/peça, OsChecklist/OsPhoto
// para checklist e fotos, ProductSerial para DOT por pneu) — nunca toca no
// arquivo restrito work-orders.routes.ts, que continua 100% sob o fluxo
// GENERAL_REPAIR.
//
// Controle por medida/DOT: a MEDIDA do pneu (ex. "185/65 R15") é atributo do
// Product (ProductVariantAxis/ProductVariant, já modelados no catálogo —
// comentário idêntico em tire-warranty.routes.ts). O DOT (código de fabricação
// gravado na lateral do pneu, identifica o pneu físico individual) é gravado em
// `ProductSerial.serialNumber` — já existe como campo genérico, aqui é só o
// primeiro uso real para esta finalidade; `ProductSerial.workOrderId` vincula o
// pneu físico específico à O.S. que o instalou.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";

export const tireServiceOrdersRouter = Router();

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
  if (!(await hasPermission(role, userId, "tires:service-order:read"))) {
    fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite consultar ordens de serviço de pneus.");
    return false;
  }
  return true;
}
async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "tires:service-order:write"))) {
    fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite abrir/atualizar ordens de serviço de pneus.");
    return false;
  }
  return true;
}

// Catálogo fixo dos três serviços do Capítulo 11.10 — cada um vira uma linha de
// mão de obra (WorkOrderItem.itemType = "LABOR") com preço informado no momento
// da abertura (preço varia por loja/região, nunca hardcoded).
const TIRE_SERVICE_LABEL: Record<string, string> = {
  MOUNTING: "Montagem",
  BALANCING: "Balanceamento",
  ALIGNMENT: "Alinhamento",
};

const createSchema = z.object({
  clientId: z.string().min(1),
  vehicleId: z.string().min(1).nullable().optional(),
  equipmentDescription: z.string().min(1), // ex.: "Veículo placa ABC-1234 — 4 pneus 185/65 R15"
  services: z
    .array(
      z.object({
        type: z.enum(["MOUNTING", "BALANCING", "ALIGNMENT"]),
        unitPrice: z.coerce.number().nonnegative(),
      }),
    )
    .min(1),
  tires: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().nonnegative(),
        dotCodes: z.array(z.string().min(1)).optional(), // um DOT por pneu físico instalado, quando rastreável por série
      }),
    )
    .optional(),
});

tireServiceOrdersRouter.post("/tire-service-orders", requireAuth, requireModule("TIRE_WARRANTY"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", parsed.error.message);
  const { tenantId } = req.session!;
  const input = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: input.clientId, tenantId } });
  if (!client) return fail(res, 404, "NOT_FOUND", "Cliente não encontrado.");
  if (input.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: input.vehicleId, tenantId } });
    if (!vehicle) return fail(res, 404, "NOT_FOUND", "Veículo não encontrado.");
  }

  const order = await prisma.$transaction(async (tx) => {
    const workOrder = await tx.workOrder.create({
      data: {
        tenantId,
        clientId: input.clientId,
        vehicleId: input.vehicleId ?? null,
        workOrderType: "TIRE_SHOP",
        equipmentDescription: input.equipmentDescription,
        reportedIssue: input.services.map((s) => TIRE_SERVICE_LABEL[s.type]).join(" + "),
        status: "RECEIVED",
      },
    });

    for (const service of input.services) {
      await tx.workOrderItem.create({
        data: {
          tenantId,
          workOrderId: workOrder.id,
          description: TIRE_SERVICE_LABEL[service.type],
          itemType: "LABOR",
          quantity: 1,
          unitPrice: service.unitPrice,
          commissionable: true,
        },
      });
    }

    for (const tire of input.tires ?? []) {
      const product = await tx.product.findFirst({ where: { id: tire.productId, tenantId } });
      if (!product) throw new Error(`Produto de pneu ${tire.productId} não encontrado.`);
      await tx.workOrderItem.create({
        data: {
          tenantId,
          workOrderId: workOrder.id,
          productId: tire.productId,
          description: product.name,
          itemType: "PART",
          quantity: tire.quantity,
          unitPrice: tire.unitPrice,
        },
      });
      // Vincula cada pneu físico (DOT) instalado a esta O.S. — cria o `ProductSerial`
      // se ainda não existir (primeiro recebimento rastreado deste pneu específico).
      for (const dotCode of tire.dotCodes ?? []) {
        await tx.productSerial.upsert({
          where: { tenantId_serialNumber: { tenantId, serialNumber: dotCode } },
          create: { tenantId, productId: tire.productId, serialNumber: dotCode, status: "IN_USE", workOrderId: workOrder.id },
          update: { status: "IN_USE", workOrderId: workOrder.id },
        });
      }
    }

    return tx.workOrder.findUniqueOrThrow({
      where: { id: workOrder.id },
      include: { items: true, client: { select: { id: true, name: true, phone: true } }, Vehicle: true, productSerials: true },
    });
  });

  const { budgetApprovalToken: _t, Vehicle, ...shaped } = order;
  return res.status(201).json({ success: true, data: { ...shaped, vehicle: Vehicle }, error: null });
});

tireServiceOrdersRouter.get("/tire-service-orders", requireAuth, requireModule("TIRE_WARRANTY"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const orders = await prisma.workOrder.findMany({
    where: { tenantId, workOrderType: "TIRE_SHOP", ...(status ? { status: status as any } : {}) },
    include: { items: true, client: { select: { id: true, name: true, phone: true } }, Vehicle: true, productSerials: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json({
    success: true,
    data: orders.map(({ budgetApprovalToken: _t, Vehicle, ...wo }) => ({ ...wo, vehicle: Vehicle })),
    error: null,
  });
});

tireServiceOrdersRouter.get("/tire-service-orders/:id", requireAuth, requireModule("TIRE_WARRANTY"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const order = await prisma.workOrder.findFirst({
    where: { id: req.params.id, tenantId, workOrderType: "TIRE_SHOP" },
    include: { items: true, client: { select: { id: true, name: true, phone: true } }, Vehicle: true, productSerials: true, checklist: true, photos: true },
  });
  if (!order) return fail(res, 404, "NOT_FOUND", "Ordem de serviço de pneus não encontrada.");
  const { budgetApprovalToken: _t, Vehicle, ...shaped } = order;
  return res.json({ success: true, data: { ...shaped, vehicle: Vehicle }, error: null });
});

const statusSchema = z.object({ status: z.enum(["IN_REPAIR", "READY", "DELIVERED", "CANCELLED"]) });

tireServiceOrdersRouter.patch("/tire-service-orders/:id/status", requireAuth, requireModule("TIRE_WARRANTY"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", parsed.error.message);
  const { tenantId } = req.session!;
  const existing = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId, workOrderType: "TIRE_SHOP" } });
  if (!existing) return fail(res, 404, "NOT_FOUND", "Ordem de serviço de pneus não encontrada.");

  const updated = await prisma.workOrder.update({
    where: { id: existing.id },
    data: { status: parsed.data.status, ...(parsed.data.status === "DELIVERED" ? { deliveredAt: new Date() } : {}) },
  });
  return res.json({ success: true, data: updated, error: null });
});
