// apps/api/src/modules/car-wash/car-wash-service.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.11 — Estética Automotiva/Lava-Rápido.
//
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 3): a fila (car-wash-queue.routes.ts)
// só tinha chegada/avanço de status — faltava a execução REAL do serviço:
// checklist de entrada (avarias pré-existentes do veículo) e checklist de saída
// (conferência pós-lavagem), com fotos antes/depois. Este router companheiro
// cria, sob demanda, uma `WorkOrder` (`workOrderType = CAR_WASH`) vinculada ao
// `Appointment` da fila (`Appointment.workOrderId`) e reaproveita 100% da
// infraestrutura genérica já existente de `OsChecklist`/`OsPhoto` — mesmo padrão
// de router companheiro de `optical-lab-work-orders.routes.ts`/
// `tire-service-orders.routes.ts`, nunca toca no arquivo restrito
// work-orders.routes.ts.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";
import { isTenantStorageKey } from "../../lib/storage-key";

export const carWashServiceRouter = Router();

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

async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "car-wash:checklist:write"))) {
    fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite registrar checklist do lava-rápido.");
    return false;
  }
  return true;
}
async function requireRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "car-wash:checklist:read"))) {
    fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite consultar checklist do lava-rápido.");
    return false;
  }
  return true;
}

// Garante que o `Appointment` tenha uma `WorkOrder` (CAR_WASH) vinculada,
// criando-a na primeira chamada (entrada). Idempotente: chamadas seguintes
// (saída) reaproveitam a mesma O.S.
async function ensureCarWashWorkOrder(tenantId: string, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId },
    include: { client: true, vehicle: true, service: true },
  });
  if (!appointment) return null;
  if (appointment.workOrderId) {
    return prisma.workOrder.findUnique({ where: { id: appointment.workOrderId } });
  }
  const workOrder = await prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.create({
      data: {
        tenantId,
        clientId: appointment.clientId,
        vehicleId: appointment.vehicleId,
        workOrderType: "CAR_WASH",
        equipmentDescription: appointment.vehicle ? `${appointment.vehicle.licensePlate} — ${appointment.vehicle.model}` : "Veículo não identificado",
        reportedIssue: `Serviço: ${appointment.service.name}`,
        status: "RECEIVED",
      },
    });
    await tx.appointment.update({ where: { id: appointment.id }, data: { workOrderId: wo.id } });
    return wo;
  });
  return workOrder;
}

const checklistSchema = z.object({
  stage: z.enum(["ENTRY", "DELIVERY"]), // ENTRY = conferência na chegada, DELIVERY = conferência na saída/entrega
  items: z.record(z.boolean()), // ex.: { "Riscos na lataria": false, "Rodas limpas": true }
  photoStorageKeys: z.array(z.string().min(1)).default([]),
});

carWashServiceRouter.post("/car-wash-queue/:appointmentId/checklist", requireAuth, requireModule("CAR_WASH_QUEUE"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const { tenantId, userId } = req.session!;
  const parsed = checklistSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", parsed.error.message);
  const input = parsed.data;

  for (const key of input.photoStorageKeys) {
    if (!isTenantStorageKey(key, tenantId)) {
      return fail(res, 400, "INVALID_STORAGE_KEY", "A chave de armazenamento deve pertencer ao tenant autenticado (tenants/<tenantId>/...).");
    }
  }

  const workOrder = await ensureCarWashWorkOrder(tenantId, req.params.appointmentId);
  if (!workOrder) return fail(res, 404, "NOT_FOUND", "Atendimento de lava-rápido não encontrado.");

  const checklist = await prisma.osChecklist.create({
    data: { tenantId, workOrderId: workOrder.id, stage: input.stage, items: input.items },
  });
  const photos = await Promise.all(
    input.photoStorageKeys.map((storageKey) =>
      prisma.osPhoto.create({
        data: { tenantId, workOrderId: workOrder.id, uploadedById: userId, storageKey, caption: input.stage === "ENTRY" ? "Antes" : "Depois" },
      }),
    ),
  );

  return res.status(201).json({ success: true, data: { checklist, photos }, error: null });
});

carWashServiceRouter.get("/car-wash-queue/:appointmentId/service-record", requireAuth, requireModule("CAR_WASH_QUEUE"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.appointmentId, tenantId } });
  if (!appointment) return fail(res, 404, "NOT_FOUND", "Atendimento de lava-rápido não encontrado.");
  if (!appointment.workOrderId) {
    return res.json({ success: true, data: { workOrder: null, checklist: [], photos: [] }, error: null });
  }
  const workOrder = await prisma.workOrder.findUnique({
    where: { id: appointment.workOrderId },
    include: { checklist: { orderBy: { createdAt: "asc" } }, photos: { orderBy: { createdAt: "asc" } } },
  });
  return res.json({ success: true, data: { workOrder, checklist: workOrder?.checklist ?? [], photos: workOrder?.photos ?? [] }, error: null });
});
