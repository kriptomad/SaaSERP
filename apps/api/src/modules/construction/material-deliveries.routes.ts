// apps/api/src/modules/construction/material-deliveries.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.8 — Material de Construção/Ferragens:
// entrega de material pesado/volumoso (areia, cimento, ferragens), agendada
// separadamente da venda porque a entrega física costuma acontecer dias depois
// da compra/pagamento no balcão (`Sale` vinculada só por `saleId` opcional).
//
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 3): o nicho não tinha nenhum
// rastreamento de entrega — era necessário ligar manualmente por telefone/papel.
//
// Permissão: reaproveita "stock:product:read"/"stock:product:write", mesmo
// domínio RBAC já usado por business-accounts.routes.ts/construction-quotes.routes.ts
// neste nicho.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";
import { readEnumQuery } from "../../lib/query-enum";

export const materialDeliveriesRouter = Router();

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
    fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite consultar entregas de material.");
    return false;
  }
  return true;
}
async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite agendar/atualizar entregas de material.");
    return false;
  }
  return true;
}

const createSchema = z.object({
  clientId: z.string().min(1),
  saleId: z.string().min(1).nullable().optional(),
  address: z.string().min(1),
  scheduledAt: z.coerce.date(),
  driverName: z.string().nullable().optional(),
  vehiclePlate: z.string().nullable().optional(),
  referenceNote: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

materialDeliveriesRouter.post("/material-deliveries", requireAuth, requireModule("CONSTRUCTION_BULK_UNITS"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", parsed.error.message);
  const { tenantId } = req.session!;
  const input = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: input.clientId, tenantId } });
  if (!client) return fail(res, 404, "NOT_FOUND", "Cliente não encontrado.");
  if (input.saleId) {
    const sale = await prisma.sale.findFirst({ where: { id: input.saleId, tenantId } });
    if (!sale) return fail(res, 404, "NOT_FOUND", "Venda não encontrada.");
    // CORREÇÃO DE AUDITORIA: a venda vinculada (`saleId`) não era checada
    // contra o `clientId` informado — permitindo registrar a entrega de
    // material em nome de um cliente diferente de quem realmente comprou
    // (`sale.clientId`), uma inconsistência que quebraria a rastreabilidade
    // financeira da entrega.
    if (sale.clientId !== input.clientId) {
      return fail(res, 409, "CLIENT_MISMATCH", "O clientId informado não corresponde ao cliente real da venda vinculada.");
    }
  }

  const delivery = await prisma.materialDelivery.create({
    data: {
      tenantId,
      clientId: input.clientId,
      saleId: input.saleId ?? null,
      address: input.address,
      scheduledAt: input.scheduledAt,
      driverName: input.driverName ?? null,
      vehiclePlate: input.vehiclePlate ?? null,
      referenceNote: input.referenceNote ?? null,
      notes: input.notes ?? null,
    },
  });
  return res.status(201).json({ success: true, data: delivery, error: null });
});

materialDeliveriesRouter.get("/material-deliveries", requireAuth, requireModule("CONSTRUCTION_BULK_UNITS"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const statusParsed = readEnumQuery(res, req.query.status, ["PENDING", "IN_TRANSIT", "DELIVERED", "CANCELLED"] as const, "status");
  if (!statusParsed.ok) return;
  const deliveries = await prisma.materialDelivery.findMany({
    where: { tenantId, ...(statusParsed.value ? { status: statusParsed.value } : {}) },
    include: { client: { select: { id: true, name: true, phone: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });
  return res.json({ success: true, data: deliveries, error: null });
});

const updateSchema = z.object({
  status: z.enum(["IN_TRANSIT", "DELIVERED", "CANCELLED"]).optional(),
  driverName: z.string().nullable().optional(),
  vehiclePlate: z.string().nullable().optional(),
  receivedByName: z.string().nullable().optional(),
  scheduledAt: z.coerce.date().optional(),
});

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

materialDeliveriesRouter.patch("/material-deliveries/:id", requireAuth, requireModule("CONSTRUCTION_BULK_UNITS"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", parsed.error.message);
  const { tenantId } = req.session!;
  const existing = await prisma.materialDelivery.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return fail(res, 404, "NOT_FOUND", "Entrega de material não encontrada.");
  const input = parsed.data;

  if (input.status) {
    const allowed = VALID_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      return fail(res, 409, "INVALID_TRANSITION", `Não é possível mudar de ${existing.status} para ${input.status}.`);
    }
    // DELIVERED exige nome de quem recebeu, para rastreabilidade (material
    // pesado/volumoso costuma ser recebido por terceiro na obra, não pelo
    // próprio cliente cadastrado).
    if (input.status === "DELIVERED" && !input.receivedByName && !existing.receivedByName) {
      return fail(res, 400, "VALIDATION_ERROR", "Informe o nome de quem recebeu a entrega (receivedByName).");
    }
  }

  const updated = await prisma.materialDelivery.update({
    where: { id: existing.id },
    data: {
      ...(input.status ? { status: input.status, ...(input.status === "DELIVERED" ? { deliveredAt: new Date() } : {}) } : {}),
      ...(input.driverName !== undefined ? { driverName: input.driverName } : {}),
      ...(input.vehiclePlate !== undefined ? { vehiclePlate: input.vehiclePlate } : {}),
      ...(input.receivedByName !== undefined ? { receivedByName: input.receivedByName } : {}),
      ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
    },
  });
  return res.json({ success: true, data: updated, error: null });
});
