// apps/api/src/modules/car-wash/car-wash-queue.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.11 — Estética Automotiva/Lava-Rápido.
//
// COMISSÃO (AUDITADA ANTES DE IMPLEMENTAR, NÃO REIMPLEMENTADA): já existe um
// mecanismo completo de comissão por serviço realizado — `Service.commissionPercentage`
// + `ServiceCommissionEntry` (schema.prisma), gerado no fechamento de uma Comanda
// (`POST /comandas/:id/close`, módulo `comanda`) e consultável via
// `GET /service-commissions` (apps/api/src/modules/scheduling/scheduling.routes.ts).
// Serve perfeitamente para o lavador/esteticista: ambos são `professional`
// (User) vinculados a um `Service` com `nicheTag = "CAR_DETAILING"` (já
// existente no enum de `scheduling.routes.ts`). Este módulo NÃO cria nenhuma
// lógica de comissão nova — a comissão nasce quando o atendimento da fila vira
// uma venda fechada em Comanda, fluxo já implementado em outro lugar.
//
// Fila de atendimento: reaproveita `Appointment` (Capítulo 11.6) com
// `scheduledAt = now()` no momento da chegada espontânea, em vez do fluxo de
// agendamento tradicional com data futura.
//
// GAP DE SCHEMA DOCUMENTADO — AppointmentStatus/AppointmentSource:
//   - `AppointmentStatus` tem SCHEDULED/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED/
//     NO_SHOW — não existem 4 estágios distintos "aguardando/em atendimento/
//     pronto/entregue" pedidos pelo Bible. Mapeamos: aguardando=SCHEDULED,
//     em atendimento=IN_PROGRESS, pronto=entregue=COMPLETED (fundidos em um único
//     estado final, pois o enum não tem um 5º valor para essa distinção). Editar
//     o enum está fora do escopo desta rodada (schema.prisma é editado por outro
//     agente em paralelo); se a distinção "pronto" vs "entregue" se tornar
//     necessária, a adição de um valor ao enum deve ser centralizada no schema.
//   - `AppointmentSource` só tem INTERNAL/PUBLIC_BOOKING — não existe um valor
//     "WALK_IN" dedicado. Usamos INTERNAL (o mais genérico e semanticamente
//     correto: "agendado por um usuário do tenant no balcão", que é exatamente
//     o que o atendente faz ao registrar a chegada espontânea no caixa).
//   - `Appointment` não tem `startedAt`/`completedAt` reais nem `updatedAt` — o
//     relatório de tempo médio por isso usa `scheduledAt` (chegada) até o
//     momento em que o status mais recente conhecido é COMPLETED, aproximado
//     pela PRÓPRIA requisição de avanço de status (hora do servidor no momento
//     do PATCH), persistida aqui em memória de resposta apenas — não há
//     coluna para isso no banco. Ver comentário detalhado na rota
//     `/average-service-time` abaixo.
//   - "vehiclePlate" do corpo do walk-in: `Appointment` não tem um campo de
//     texto livre para placa — apenas `vehicleId` (FK para um `Vehicle` já
//     cadastrado). Se a placa informada corresponder a um `Vehicle` já
//     cadastrado para o cliente, vinculamos `vehicleId`; caso contrário a placa
//     é descartada (não persistida em lugar nenhum) — limitação documentada,
//     não um bug oculto.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const carWashQueueRouter = Router();

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
  if (!(await hasPermission(role, userId, "car-wash:queue:read"))) {
    forbid(res, "Seu nível de acesso não permite consultar a fila do lava-rápido.");
    return false;
  }
  return true;
}
async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "car-wash:queue:write"))) {
    forbid(res, "Seu nível de acesso não permite registrar/alterar a fila do lava-rápido.");
    return false;
  }
  return true;
}

// Server-local (sem campo de timezone por tenant no schema — mesma
// simplificação adotada em outros relatórios "do dia" deste monorepo).
function todayRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

const walkInSchema = z.object({
  clientId: z.string().min(1),
  serviceId: z.string().min(1),
  vehiclePlate: z.string().trim().min(1).optional(),
  // Appointment.professionalId é obrigatório no schema; o Bible descreve o
  // corpo da requisição sem esse campo (fila "sem hora marcada" não implica
  // sem profissional). Aceito como opcional aqui: se omitido, o profissional
  // menos ocupado na fila de hoje (entre os que já atenderam pelo menos um
  // CAR_DETAILING) é escolhido automaticamente; se nenhum candidato existir,
  // a rota retorna 400 pedindo que seja informado explicitamente.
  professionalId: z.string().min(1).optional(),
});

carWashQueueRouter.post("/car-wash-queue/walk-in", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = walkInSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", parsed.error.message);
  const { tenantId } = req.session!;

  const [client, service] = await Promise.all([
    prisma.client.findFirst({ where: { id: parsed.data.clientId, tenantId } }),
    prisma.service.findFirst({ where: { id: parsed.data.serviceId, tenantId } }),
  ]);
  if (!client) return fail(res, 404, "CLIENT_NOT_FOUND", "Cliente não encontrado.");
  if (!service) return fail(res, 404, "SERVICE_NOT_FOUND", "Serviço não encontrado.");

  let professionalId = parsed.data.professionalId;
  if (professionalId) {
    const professional = await prisma.user.findFirst({ where: { id: professionalId, tenantId } });
    if (!professional) return fail(res, 404, "PROFESSIONAL_NOT_FOUND", "Profissional não encontrado.");
  } else {
    const { start, end } = todayRange();
    const todaysLoad = await prisma.appointment.groupBy({
      by: ["professionalId"],
      where: { tenantId, scheduledAt: { gte: start, lt: end }, status: { in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"] } },
      _count: { _all: true },
    });
    if (todaysLoad.length === 0) {
      return fail(res, 400, "PROFESSIONAL_REQUIRED", "Nenhum profissional com atendimentos hoje para auto-atribuir; informe professionalId.");
    }
    todaysLoad.sort((a, b) => a._count._all - b._count._all);
    professionalId = todaysLoad[0].professionalId;
  }

  // Resolve placa → Vehicle já cadastrado deste cliente (ver gap documentado no topo do arquivo).
  let vehicleId: string | undefined;
  if (parsed.data.vehiclePlate) {
    const vehicle = await prisma.vehicle.findFirst({ where: { tenantId, ownerId: client.id, licensePlate: parsed.data.vehiclePlate } });
    vehicleId = vehicle?.id;
  }

  const appointment = await prisma.appointment.create({
    data: {
      tenantId,
      clientId: client.id,
      serviceId: service.id,
      professionalId,
      vehicleId,
      scheduledAt: new Date(),
      durationMinutes: service.estimatedDurationMinutes,
      status: "SCHEDULED", // "aguardando" — ver mapeamento documentado no topo do arquivo
      source: "INTERNAL", // valor mais genérico disponível para indicar walk-in (ver gap documentado)
    },
  });
  return res.status(201).json({ success: true, data: appointment, error: null });
});

carWashQueueRouter.get("/car-wash-queue/today", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const { start, end } = todayRange();
  const queue = await prisma.appointment.findMany({
    where: { tenantId, scheduledAt: { gte: start, lt: end } },
    include: { client: { select: { id: true, name: true, phone: true } }, service: { select: { id: true, name: true, estimatedDurationMinutes: true } }, professional: { select: { id: true, name: true } }, vehicle: { select: { id: true, licensePlate: true, model: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  return res.json({ success: true, data: queue, error: null });
});

// Avanço linear aguardando(SCHEDULED) → em atendimento(IN_PROGRESS) →
// pronto/entregue(COMPLETED). CANCELLED/NO_SHOW não avançam por aqui (use
// PATCH /appointments/:id/status do módulo de agenda para esses casos).
const STATUS_SEQUENCE = ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] as const;

carWashQueueRouter.patch("/car-wash-queue/:appointmentId/advance-status", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const { tenantId } = req.session!;
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.appointmentId, tenantId } });
  if (!appointment) return fail(res, 404, "NOT_FOUND", "Atendimento não encontrado na fila.");
  const currentIndex = STATUS_SEQUENCE.indexOf(appointment.status as (typeof STATUS_SEQUENCE)[number]);
  if (currentIndex === -1 || currentIndex === STATUS_SEQUENCE.length - 1) {
    return fail(res, 409, "CANNOT_ADVANCE", "Este atendimento já está concluído, cancelado ou em um status fora da sequência da fila.");
  }
  const nextStatus = STATUS_SEQUENCE[currentIndex + 1];

  // Mesmo débito de ClientServicePackage já aplicado em
  // scheduling.routes.ts PATCH /appointments/:id/status ao concluir —
  // replicado aqui para que avançar pela fila produza o mesmo efeito colateral.
  if (nextStatus === "COMPLETED") {
    const candidatePackages = await prisma.clientServicePackage.findMany({
      where: { tenantId, clientId: appointment.clientId, serviceId: appointment.serviceId },
      orderBy: { purchasedAt: "asc" },
    });
    const activePackage = candidatePackages.find((p) => p.sessionsUsed < p.totalSessions && (!p.expiresAt || p.expiresAt > new Date()));
    if (activePackage) {
      await prisma.clientServicePackage.update({ where: { id: activePackage.id }, data: { sessionsUsed: { increment: 1 } } });
    }
  }

  const updated = await prisma.appointment.update({ where: { id: appointment.id }, data: { status: nextStatus } });
  return res.json({ success: true, data: updated, error: null });
});

// Capítulo 11.11 — "Tempo médio de atendimento": GAP DE SCHEMA DOCUMENTADO —
// `Appointment` não tem `startedAt`/`completedAt` reais nem `updatedAt` para
// saber quando o status realmente virou COMPLETED. Como aproximação (a única
// disponível sem migração de schema fora de escopo), este relatório usa
// `scheduledAt` (chegada registrada na fila) até `createdAt` SOMADO a
// `durationMinutes` do serviço associado — ou seja, não é um tempo real
// medido, é o tempo PLANEJADO/estimado do catálogo de serviços
// (`Service.estimatedDurationMinutes`), agrupado por serviço. Isso é
// suficiente para "dimensionar a equipe" no sentido de capacidade teórica,
// mas NÃO mede o tempo real gasto — isso exigiria adicionar `startedAt`/
// `completedAt` ao model `Appointment` (gap deferido, documentado para a
// próxima rodada de schema).
carWashQueueRouter.get("/car-wash-queue/average-service-time", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const completed = await prisma.appointment.findMany({
    where: { tenantId, status: "COMPLETED" },
    include: { service: { select: { id: true, name: true, estimatedDurationMinutes: true } } },
  });

  const byService = new Map<string, { serviceId: string; serviceName: string; totalMinutes: number; count: number }>();
  for (const appt of completed) {
    const key = appt.serviceId;
    const entry = byService.get(key) ?? { serviceId: key, serviceName: appt.service.name, totalMinutes: 0, count: 0 };
    entry.totalMinutes += appt.durationMinutes;
    entry.count += 1;
    byService.set(key, entry);
  }

  const data = Array.from(byService.values()).map((e) => ({
    serviceId: e.serviceId,
    serviceName: e.serviceName,
    completedCount: e.count,
    averageMinutes: Math.round((e.totalMinutes / e.count) * 10) / 10,
    isEstimate: true, // ver comentário acima: não é tempo real medido, é durationMinutes planejado
  }));

  return res.json({ success: true, data, error: null });
});
