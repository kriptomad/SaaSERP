// apps/api/src/modules/public-booking/public-booking.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.6 (Salão de Beleza/Barbearia) —
// "Agendamento online self-service": página pública (SEM autenticação) onde o
// cliente final vê os serviços e horários livres de cada profissional e agenda
// sozinho. GAP DE AUDITORIA EXPLÍCITO (já adiado na Rodada 4 pela ausência do
// cadastro de expediente por profissional — ver `ProfessionalWorkingHours`,
// adicionado nesta rodada) — fechado agora.
//
// Rotas deliberadamente SEM requireAuth/tenantContextMiddleware: o tenant é
// resolvido pelo `:tenantSlug` da própria URL (análogo ao padrão de subdomínio
// público da Vitrine Virtual, Capítulo 8.5 — que na auditoria desta rodada se
// confirmou que AINDA NÃO existe nenhuma implementação real em
// `apps/web`/`apps/api` para replicar; o padrão aqui foi desenhado do zero
// seguindo a mesma ideia de "slug público" já usada em `Tenant.slug`).
// Proteção de corrida: exatamente o `@@unique([tenantId, professionalId, scheduledAt])`
// que já existe no schema (Capítulo 11.6) — nunca uma checagem manual SELECT+INSERT
// (que teria TOCTOU), a violação do Postgres é traduzida em 409 SLOT_ALREADY_TAKEN.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { isTenantLocked } from "../../middlewares/tenant-lockout.middleware";
import { enforceRateLimit, RateLimitExceededError } from "../../lib/rate-limit";

// GAP DE AUDITORIA FECHADO: agenda online pública não tinha NENHUM rate limiting —
// qualquer script podia lotar a agenda de um tenant com agendamentos falsos em
// volume ilimitado, ou raspar `/slots` em loop. Mesmo padrão já usado em
// lookup.routes.ts (IP + janela), aplicado aqui à criação de agendamento (escrita
// real no banco) e à consulta de horários (superfície de scraping).
const PUBLIC_BOOKING_WRITE_RATE_LIMIT_MAX = 10;
const PUBLIC_BOOKING_WRITE_RATE_LIMIT_WINDOW_SECONDS = 60;
const PUBLIC_BOOKING_READ_RATE_LIMIT_MAX = 60;
const PUBLIC_BOOKING_READ_RATE_LIMIT_WINDOW_SECONDS = 60;

export const publicBookingRouter = Router();

// GAP DE AUDITORIA FECHADO (Rodada 6) — esta rota pública nunca checava
// `Tenant.status`: um tenant SUSPENDED/CANCELLED (ou PAST_DUE fora do grace period)
// continuava recebendo agendamentos novos indefinidamente pela página pública, mesmo
// com o app autenticado inteiro bloqueado por `tenantLockoutMiddleware` (Capítulo 2).
// Mesma regra de negócio (`isTenantLocked`), nunca duplicada — e mesmo tratamento de
// "não encontrado" dos outros bloqueios aqui (nunca revela que o slug existe mas está
// suspenso, evitando enumeração de tenants inadimplentes).
async function resolveTenantBySlug(slug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, tradeName: true, status: true, gracePeriodEndsAt: true },
  });
  if (!tenant || isTenantLocked(tenant)) return null;
  return tenant;
}

function notFoundTenant(res: Response) {
  return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Estabelecimento não encontrado." } });
}

publicBookingRouter.get("/public-booking/:tenantSlug", async (req: Request, res: Response) => {
  const tenant = await resolveTenantBySlug(req.params.tenantSlug);
  if (!tenant) return notFoundTenant(res);
  return res.json({ success: true, data: { id: tenant.id, name: tenant.tradeName }, error: null });
});

publicBookingRouter.get("/public-booking/:tenantSlug/services", async (req: Request, res: Response) => {
  const tenant = await resolveTenantBySlug(req.params.tenantSlug);
  if (!tenant) return notFoundTenant(res);
  const services = await prisma.service.findMany({
    where: { tenantId: tenant.id, active: true },
    select: { id: true, name: true, basePrice: true, estimatedDurationMinutes: true, nicheTag: true },
    orderBy: { name: "asc" },
  });
  return res.json({ success: true, data: services, error: null });
});

// Só lista profissionais que têm ao menos um expediente cadastrado
// (`ProfessionalWorkingHours`) — exclui usuários administrativos/sem agenda
// pública da vitrine de agendamento.
publicBookingRouter.get("/public-booking/:tenantSlug/professionals", async (req: Request, res: Response) => {
  const tenant = await resolveTenantBySlug(req.params.tenantSlug);
  if (!tenant) return notFoundTenant(res);
  const professionals = await prisma.user.findMany({
    where: { tenantId: tenant.id, active: true, workingHours: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return res.json({ success: true, data: professionals, error: null });
});

const slotsQuerySchema = z.object({
  professionalId: z.string().min(1),
  serviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date deve estar no formato YYYY-MM-DD"),
});

const SLOT_STEP_MINUTES = 15; // granularidade de geração de slots candidatos, independente da duração do serviço

function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

publicBookingRouter.get("/public-booking/:tenantSlug/slots", async (req: Request, res: Response) => {
  try {
    await enforceRateLimit(`public-booking:slots:${req.ip}`, PUBLIC_BOOKING_READ_RATE_LIMIT_MAX, PUBLIC_BOOKING_READ_RATE_LIMIT_WINDOW_SECONDS);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
  const tenant = await resolveTenantBySlug(req.params.tenantSlug);
  if (!tenant) return notFoundTenant(res);
  const parsed = slotsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });

  const [service, professional] = await Promise.all([
    prisma.service.findFirst({ where: { id: parsed.data.serviceId, tenantId: tenant.id, active: true } }),
    prisma.user.findFirst({ where: { id: parsed.data.professionalId, tenantId: tenant.id, active: true } }),
  ]);
  if (!service) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Serviço não encontrado." } });
  if (!professional) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Profissional não encontrado." } });

  const [year, month, day] = parsed.data.date.split("-").map(Number);
  const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
  const dayOfWeek = dayStart.getDay();

  const workingHours = await prisma.professionalWorkingHours.findUnique({
    where: { tenantId_professionalId_dayOfWeek: { tenantId: tenant.id, professionalId: professional.id, dayOfWeek } },
  });
  // Sem expediente cadastrado para este profissional/dia -> nenhum horário livre
  // (fail-closed, nunca inventa um expediente padrão genérico).
  if (!workingHours) return res.json({ success: true, data: [], error: null });

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      tenantId: tenant.id,
      professionalId: professional.id,
      scheduledAt: { gte: dayStart, lte: dayEnd },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
    select: { scheduledAt: true, durationMinutes: true },
  });

  const durationMinutes = service.estimatedDurationMinutes;
  const startMinutes = parseHHMM(workingHours.startTime);
  const endMinutes = parseHHMM(workingHours.endTime);
  const now = new Date();

  const freeSlots: string[] = [];
  for (let candidateStart = startMinutes; candidateStart + durationMinutes <= endMinutes; candidateStart += SLOT_STEP_MINUTES) {
    const slotStart = new Date(year, month - 1, day, 0, candidateStart, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);
    if (slotStart <= now) continue; // nunca oferece horário já passado

    const overlaps = existingAppointments.some((appt) => {
      const apptStart = appt.scheduledAt;
      const apptEnd = new Date(apptStart.getTime() + appt.durationMinutes * 60_000);
      return slotStart < apptEnd && apptStart < slotEnd;
    });
    if (!overlaps) freeSlots.push(slotStart.toISOString());
  }

  return res.json({ success: true, data: freeSlots, error: null });
});

const createPublicAppointmentSchema = z.object({
  professionalId: z.string().min(1),
  serviceId: z.string().min(1),
  scheduledAt: z.string().datetime(),
  clientName: z.string().min(1),
  clientPhone: z.string().min(8),
});

publicBookingRouter.post("/public-booking/:tenantSlug/appointments", async (req: Request, res: Response) => {
  try {
    await enforceRateLimit(`public-booking:create:${req.ip}`, PUBLIC_BOOKING_WRITE_RATE_LIMIT_MAX, PUBLIC_BOOKING_WRITE_RATE_LIMIT_WINDOW_SECONDS);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
  const tenant = await resolveTenantBySlug(req.params.tenantSlug);
  if (!tenant) return notFoundTenant(res);
  const parsed = createPublicAppointmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });

  const [service, professional] = await Promise.all([
    prisma.service.findFirst({ where: { id: parsed.data.serviceId, tenantId: tenant.id, active: true } }),
    prisma.user.findFirst({ where: { id: parsed.data.professionalId, tenantId: tenant.id, active: true } }),
  ]);
  if (!service) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Serviço não encontrado." } });
  if (!professional) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Profissional não encontrado." } });

  try {
    const appointment = await prisma.$transaction(async (tx) => {
      // Upsert de Client por telefone (documento) — cliente novo vindo da agenda
      // pública nunca precisa de cadastro completo prévio (fricção mínima).
      const client = await tx.client.upsert({
        where: { tenantId_document: { tenantId: tenant.id, document: parsed.data.clientPhone } },
        create: { tenantId: tenant.id, name: parsed.data.clientName, phone: parsed.data.clientPhone, document: parsed.data.clientPhone },
        update: { name: parsed.data.clientName, phone: parsed.data.clientPhone },
      });

      return tx.appointment.create({
        data: {
          tenantId: tenant.id,
          clientId: client.id,
          professionalId: parsed.data.professionalId,
          serviceId: parsed.data.serviceId,
          scheduledAt: new Date(parsed.data.scheduledAt),
          durationMinutes: service.estimatedDurationMinutes,
          source: "PUBLIC_BOOKING",
        },
      });
    });
    return res.status(201).json({ success: true, data: appointment, error: null });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "SLOT_ALREADY_TAKEN", message: "Este horário acabou de ser reservado por outro cliente. Escolha outro horário." } });
    }
    throw err;
  }
});
