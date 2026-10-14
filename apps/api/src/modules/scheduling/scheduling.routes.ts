// apps/api/src/modules/scheduling/scheduling.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.2/4.7/11.6 (Serviços e Agendamento —
// Petshop, Salão/Barbearia, Estética Automotiva) e Capítulo 11.6 (Agenda Online
// pública de reserva de horário).
// GAP DE AUDITORIA ENCONTRADO: `Service`/`Appointment`/`ClientServicePackage`
// existiam no schema (com `@@unique([tenantId, professionalId, scheduledAt])`
// anti-duplo-agendamento já modelado), mas nenhuma rota REST jamais existiu.
// Novos códigos de permissão seedados nesta correção: "scheduling:service:read/write"
// e "scheduling:appointment:read/write" (não existiam no seed.ts anterior).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireAnyModule } from "../../middlewares/gatekeeper.middleware";

export const schedulingRouter = Router();

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

// ───────────────────────── Service (catálogo de serviços) ─────────────────────────

const serviceSchema = z.object({
  name: z.string().min(1),
  nicheTag: z.enum(["PETSHOP", "BEAUTY_SALON", "CAR_DETAILING", "AUTOMOTIVE_WORKSHOP"]),
  basePrice: z.number().positive(),
  estimatedDurationMinutes: z.number().int().positive(),
  commissionPercentage: z.number().min(0).max(100).optional(),
  active: z.boolean().optional(),
});

schedulingRouter.get("/services", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:service:read"))) return forbid(res, "Seu nível de acesso não permite consultar o catálogo de serviços.");
  const services = await prisma.service.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  return res.json({ success: true, data: services, error: null });
});

schedulingRouter.post("/services", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:service:write"))) return forbid(res, "Seu nível de acesso não permite cadastrar serviços.");
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const service = await prisma.service.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: service, error: null });
});

schedulingRouter.patch("/services/:id", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:service:write"))) return forbid(res, "Seu nível de acesso não permite editar serviços.");
  const parsed = serviceSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const existing = await prisma.service.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Serviço não encontrado." } });
  const service = await prisma.service.update({ where: { id: existing.id }, data: parsed.data });
  return res.json({ success: true, data: service, error: null });
});

// ───────────────────────── ProfessionalWorkingHours (expediente — base da Agenda Online pública) ─────────────────────────

const workingHoursSchema = z.object({
  professionalId: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "startTime deve estar no formato HH:mm"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "endTime deve estar no formato HH:mm"),
});

schedulingRouter.get("/professional-working-hours", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:appointment:read"))) return forbid(res, "Seu nível de acesso não permite consultar expedientes.");
  const professionalId = req.query.professionalId as string | undefined;
  const entries = await prisma.professionalWorkingHours.findMany({
    where: { tenantId, ...(professionalId ? { professionalId } : {}) },
    orderBy: [{ professionalId: "asc" }, { dayOfWeek: "asc" }],
  });
  return res.json({ success: true, data: entries, error: null });
});

// Upsert por (tenantId, professionalId, dayOfWeek) — reenviar o mesmo dia da
// semana para um profissional atualiza o expediente existente, nunca duplica.
schedulingRouter.put("/professional-working-hours", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:appointment:write"))) return forbid(res, "Seu nível de acesso não permite configurar expedientes.");
  const parsed = workingHoursSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const professional = await prisma.user.findFirst({ where: { id: parsed.data.professionalId, tenantId } });
  if (!professional) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Profissional não encontrado." } });
  const entry = await prisma.professionalWorkingHours.upsert({
    where: { tenantId_professionalId_dayOfWeek: { tenantId, professionalId: parsed.data.professionalId, dayOfWeek: parsed.data.dayOfWeek } },
    create: { tenantId, ...parsed.data },
    update: { startTime: parsed.data.startTime, endTime: parsed.data.endTime },
  });
  return res.status(201).json({ success: true, data: entry, error: null });
});

schedulingRouter.delete("/professional-working-hours/:id", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:appointment:write"))) return forbid(res, "Seu nível de acesso não permite configurar expedientes.");
  await prisma.professionalWorkingHours.deleteMany({ where: { id: req.params.id, tenantId } });
  return res.status(204).send();
});

// ───────────────────────── Appointment (agenda) ─────────────────────────

const createAppointmentSchema = z.object({
  clientId: z.string().min(1),
  serviceId: z.string().min(1),
  professionalId: z.string().min(1),
  petId: z.string().optional(),
  vehicleId: z.string().optional(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().optional(),
  source: z.enum(["INTERNAL", "PUBLIC_BOOKING"]).optional(),
});

schedulingRouter.get("/appointments", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:appointment:read"))) return forbid(res, "Seu nível de acesso não permite consultar a agenda.");
  const { professionalId, from, to, status } = req.query as Record<string, string | undefined>;
  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      ...(professionalId ? { professionalId } : {}),
      ...(status ? { status: status as any } : {}),
      ...(from || to ? { scheduledAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    },
    include: { client: { select: { id: true, name: true } }, service: true, professional: { select: { id: true, name: true } }, pet: true, vehicle: true },
    orderBy: { scheduledAt: "asc" },
  });
  return res.json({ success: true, data: appointments, error: null });
});

schedulingRouter.get("/appointments/:id", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:appointment:read"))) return forbid(res, "Seu nível de acesso não permite consultar a agenda.");
  const appointment = await prisma.appointment.findFirst({
    where: { id: req.params.id, tenantId },
    include: { client: true, service: true, professional: { select: { id: true, name: true } }, pet: true, vehicle: true },
  });
  if (!appointment) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Agendamento não encontrado." } });
  return res.json({ success: true, data: appointment, error: null });
});

// Anti-duplo-agendamento: a constraint real que impede a colisão é o
// `@@unique([tenantId, professionalId, scheduledAt])` do schema — este handler
// apenas traduz a violação dessa constraint em um erro 409 legível, nunca
// reimplementando a checagem manualmente (que teria race condition entre o
// SELECT de verificação e o INSERT, Capítulo 6.3).
schedulingRouter.post("/appointments", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:appointment:write"))) return forbid(res, "Seu nível de acesso não permite criar agendamentos.");
  const parsed = createAppointmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });

  const service = await prisma.service.findFirst({ where: { id: parsed.data.serviceId, tenantId } });
  if (!service) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Serviço não encontrado." } });

  // Correção de auditoria (FK injection): client/professional/pet/vehicle vêm do
  // corpo da requisição e, sem esta checagem, um usuário mal-intencionado poderia
  // vincular o agendamento a um registro de OUTRO tenant (mesmo padrão já corrigido
  // em work-orders/personal-accounts/purchase-orders em rodadas anteriores).
  const [client, professional, pet, vehicle] = await Promise.all([
    prisma.client.findFirst({ where: { id: parsed.data.clientId, tenantId } }),
    prisma.user.findFirst({ where: { id: parsed.data.professionalId, tenantId } }),
    parsed.data.petId ? prisma.pet.findFirst({ where: { id: parsed.data.petId, tenantId } }) : null,
    parsed.data.vehicleId ? prisma.vehicle.findFirst({ where: { id: parsed.data.vehicleId, tenantId } }) : null,
  ]);
  if (!client) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Cliente não encontrado." } });
  if (!professional) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Profissional não encontrado." } });
  if (parsed.data.petId && !pet) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pet não encontrado." } });
  if (parsed.data.vehicleId && !vehicle) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Veículo não encontrado." } });

  try {
    const appointment = await prisma.appointment.create({
      data: {
        tenantId,
        clientId: parsed.data.clientId,
        serviceId: parsed.data.serviceId,
        professionalId: parsed.data.professionalId,
        petId: parsed.data.petId,
        vehicleId: parsed.data.vehicleId,
        scheduledAt: new Date(parsed.data.scheduledAt),
        durationMinutes: parsed.data.durationMinutes ?? service.estimatedDurationMinutes,
        source: parsed.data.source ?? "INTERNAL",
      },
    });
    return res.status(201).json({ success: true, data: appointment, error: null });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "PROFESSIONAL_ALREADY_BOOKED", message: "Este profissional já possui um agendamento exatamente neste horário." } });
    }
    throw err;
  }
});

const statusSchema = z.object({ status: z.enum(["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]) });

schedulingRouter.patch("/appointments/:id/status", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:appointment:write"))) return forbid(res, "Seu nível de acesso não permite alterar o status de agendamentos.");
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, tenantId } });
  if (!appointment) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Agendamento não encontrado." } });

  // Ao concluir um atendimento vinculado a um pacote pré-pago (Capítulo 4.2),
  // debita uma sessão do ClientServicePackage ativo do cliente para o mesmo
  // serviço — nunca cobra novamente nem ignora o pacote contratado.
  if (parsed.data.status === "COMPLETED") {
    const candidatePackages = await prisma.clientServicePackage.findMany({
      where: { tenantId, clientId: appointment.clientId, serviceId: appointment.serviceId },
      orderBy: { purchasedAt: "asc" },
    });
    const activePackage = candidatePackages.find((p) => p.sessionsUsed < p.totalSessions && (!p.expiresAt || p.expiresAt > new Date()));
    if (activePackage) {
      await prisma.clientServicePackage.update({ where: { id: activePackage.id }, data: { sessionsUsed: { increment: 1 } } });
    }
  }

  const updated = await prisma.appointment.update({ where: { id: appointment.id }, data: { status: parsed.data.status } });
  return res.json({ success: true, data: updated, error: null });
});

// ───────────────────────── ClientServicePackage (pacote pré-pago) ─────────────────────────

const packageSchema = z.object({
  clientId: z.string().min(1),
  serviceId: z.string().min(1),
  totalSessions: z.number().int().positive(),
  expiresAt: z.string().datetime().optional(),
});

schedulingRouter.get("/client-service-packages", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:service:read"))) return forbid(res, "Seu nível de acesso não permite consultar pacotes de sessões.");
  const clientId = req.query.clientId as string | undefined;
  const packages = await prisma.clientServicePackage.findMany({ where: { tenantId, ...(clientId ? { clientId } : {}) }, include: { service: true }, orderBy: { purchasedAt: "desc" } });
  return res.json({ success: true, data: packages, error: null });
});

schedulingRouter.post("/client-service-packages", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:service:write"))) return forbid(res, "Seu nível de acesso não permite vender pacotes de sessões.");
  const parsed = packageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });

  // CORREÇÃO DE AUDITORIA (FK injection): esta rota não validava clientId/serviceId
  // contra o tenant (diferente de POST /appointments, que já faz essa checagem) —
  // um usuário mal-intencionado podia vender/vincular um pacote a um cliente ou
  // serviço de OUTRO tenant.
  const [client, service] = await Promise.all([
    prisma.client.findFirst({ where: { id: parsed.data.clientId, tenantId } }),
    prisma.service.findFirst({ where: { id: parsed.data.serviceId, tenantId } }),
  ]);
  if (!client) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Cliente não encontrado." } });
  if (!service) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Serviço não encontrado." } });

  const pkg = await prisma.clientServicePackage.create({
    data: { tenantId, clientId: parsed.data.clientId, serviceId: parsed.data.serviceId, totalSessions: parsed.data.totalSessions, expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined },
  });
  return res.status(201).json({ success: true, data: pkg, error: null });
});

// ───────────────────────── ServiceCommissionEntry (comissão por profissional) ─────────────────────────
// Capítulo 11.6 — apenas leitura aqui: os registros são criados exclusivamente no
// fechamento+pagamento da Comanda (`comanda.routes.ts` POST /comandas/:id/close),
// nunca por este módulo. Reaproveita "scheduling:appointment:read" (mesmo domínio
// operacional de agenda/profissional) em vez de criar um código de permissão novo.
schedulingRouter.get("/service-commissions", requireAuth, requireAnyModule(["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"]), async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "scheduling:appointment:read"))) return forbid(res, "Seu nível de acesso não permite consultar comissões de serviço.");
  const { professionalId, from, to } = req.query as Record<string, string | undefined>;
  const entries = await prisma.serviceCommissionEntry.findMany({
    where: {
      tenantId,
      ...(professionalId ? { professionalId } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    },
    include: { professional: { select: { id: true, name: true } }, service: { select: { id: true, name: true } }, sale: { select: { id: true, createdAt: true } } },
    orderBy: { createdAt: "desc" },
  });
  const totalCommission = entries.reduce((acc, e) => acc.plus(e.commissionAmount), new Prisma.Decimal(0));
  return res.json({ success: true, data: { entries, totalCommission }, error: null });
});
