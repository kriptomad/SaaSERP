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
import { Prisma, prismaUnscoped as prisma } from "@filitech/db";
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
    select: { id: true, tradeName: true, status: true, gracePeriodEndsAt: true, trialEndsAt: true },
  });
  if (!tenant || isTenantLocked(tenant)) return null;
  return tenant;
}

function notFoundTenant(res: Response) {
  return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Estabelecimento não encontrado." } });
}

publicBookingRouter.get("/public-booking/:tenantSlug", async (req: Request, res: Response) => {
  // GAP DE AUDITORIA FECHADO: a rota "landing" (primeira chamada de qualquer
  // visitante, inclusive bots) era a ÚNICA rota pública deste router sem nenhum
  // rate limit — mesmo padrão de scraping já fechado nas rotas abaixo.
  try {
    await enforceRateLimit(`public-booking:${req.params.tenantSlug}:read:${req.ip}`, PUBLIC_BOOKING_READ_RATE_LIMIT_MAX, PUBLIC_BOOKING_READ_RATE_LIMIT_WINDOW_SECONDS);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
  const tenant = await resolveTenantBySlug(req.params.tenantSlug);
  if (!tenant) return notFoundTenant(res);
  return res.json({ success: true, data: { id: tenant.id, name: tenant.tradeName }, error: null });
});

publicBookingRouter.get("/public-booking/:tenantSlug/services", async (req: Request, res: Response) => {
  // GAP DE AUDITORIA FECHADO (Rodada 11): esta rota e `/professionals` faziam
  // consulta anônima ao banco sem NENHUM rate limit, diferente de `/slots` e
  // `/appointments` — um crawler podia enumerar catálogo de serviços/preços e
  // profissionais de qualquer tenant em loop irrestrito.
  try {
    await enforceRateLimit(`public-booking:${req.params.tenantSlug}:read:${req.ip}`, PUBLIC_BOOKING_READ_RATE_LIMIT_MAX, PUBLIC_BOOKING_READ_RATE_LIMIT_WINDOW_SECONDS);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
  const tenant = await resolveTenantBySlug(req.params.tenantSlug);
  if (!tenant) return notFoundTenant(res);
  const services = await prisma.service.findMany({
    where: { tenantId: tenant.id, active: true },
    select: { id: true, name: true, basePrice: true, estimatedDurationMinutes: true, nicheTag: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  return res.json({ success: true, data: services, error: null });
});

// Só lista profissionais que têm ao menos um expediente cadastrado
// (`ProfessionalWorkingHours`) — exclui usuários administrativos/sem agenda
// pública da vitrine de agendamento.
publicBookingRouter.get("/public-booking/:tenantSlug/professionals", async (req: Request, res: Response) => {
  try {
    await enforceRateLimit(`public-booking:${req.params.tenantSlug}:read:${req.ip}`, PUBLIC_BOOKING_READ_RATE_LIMIT_MAX, PUBLIC_BOOKING_READ_RATE_LIMIT_WINDOW_SECONDS);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
  const tenant = await resolveTenantBySlug(req.params.tenantSlug);
  if (!tenant) return notFoundTenant(res);
  const professionals = await prisma.user.findMany({
    where: { tenantId: tenant.id, active: true, workingHours: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  return res.json({ success: true, data: professionals, error: null });
});

// GAP DE AUDITORIA FECHADO (fa-w4-publicbooking-date-tz): a regex abaixo só checava
// o FORMATO "YYYY-MM-DD" (shape), nunca se o calendário era real — "2026-99-99"
// passava ileso e o construtor `new Date(year, month-1, day)` do JS faz "rollover"
// silencioso (ex.: mês 13 vira janeiro do ano seguinte), produzindo um dia
// completamente diferente do que o cliente pediu sem nenhum erro. `isValidCalendarDate`
// faz a checagem real: reconstrói a data em UTC e confere que ano/mês/dia voltam
// EXATAMENTE iguais ao que foi informado (nenhum rollover passa despercebido).
//
// POLÍTICA DE FUSO HORÁRIO (GAP DE AUDITORIA FECHADO — fa-w4-publicbooking-date-tz):
// nem `Tenant` nem `User` (profissional) têm campo de timezone no schema hoje — não
// existe fuso "do tenant" para consultar. Para que a geração de slots (`/slots`) e a
// criação do agendamento (`POST /appointments`) NUNCA divirjam entre si dependendo do
// fuso horário configurado no processo Node do servidor (`TZ` de ambiente, que pode
// variar entre deploys/containers), as duas rotas abaixo usam EXCLUSIVAMENTE
// `Date.UTC(...)`/getters `getUTC*` para montar e interpretar "o dia", "o dia da
// semana" e "a hora" — nunca o construtor local (`new Date(y,m,d,...)`) nem getters
// locais (`getDay`/`getHours`/...), que dependiam do fuso do SO do servidor. Ou seja:
// o campo `date` (YYYY-MM-DD) e o expediente (`ProfessionalWorkingHours.startTime`/
// `endTime`, "HH:mm") são sempre interpretados como horário UTC. Se no futuro o
// produto precisar de um fuso por tenant, introduzir `Tenant.timezone` e substituir
// os `Date.UTC`/`getUTC*` abaixo por conversões explícitas para esse fuso — nunca
// voltar a depender do fuso local do processo.
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidDateOnlyString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  return isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

// Mesmo problema de rollover silencioso existe em datas ISO completas: o z.string().datetime()
// do zod valida o FORMATO (shape), mas "2026-02-30T10:00:00.000Z" casa com o formato e
// o `new Date(...)` também faz rollover silencioso para 2026-03-02. Reaplica a mesma
// checagem de calendário real sobre a porção YYYY-MM-DD do timestamp ISO.
function isValidIsoDatetimeCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match) return false;
  return isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

const slotsQuerySchema = z.object({
  professionalId: z.string().min(1).max(100),
  serviceId: z.string().min(1).max(100),
  date: z
    .string()
    .max(10)
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date deve estar no formato YYYY-MM-DD")
    .refine(isValidDateOnlyString, "date deve ser uma data de calendário válida"),
});

const SLOT_STEP_MINUTES = 15; // granularidade de geração de slots candidatos, independente da duração do serviço

function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

publicBookingRouter.get("/public-booking/:tenantSlug/slots", async (req: Request, res: Response) => {
  try {
    // GAP DE AUDITORIA FECHADO (Rodada 11): a chave não incluía `tenantSlug`, então
    // um único IP (NAT compartilhado, torre de celular) esgotava o balde de 60
    // requisições para TODOS os tenants ao consultar qualquer um deles.
    await enforceRateLimit(`public-booking:${req.params.tenantSlug}:slots:${req.ip}`, PUBLIC_BOOKING_READ_RATE_LIMIT_MAX, PUBLIC_BOOKING_READ_RATE_LIMIT_WINDOW_SECONDS);
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
  // Política de fuso UTC (ver comentário acima de `isValidCalendarDate`): construção
  // e leitura sempre em UTC, nunca local, para nunca divergir da criação do agendamento.
  const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  const dayOfWeek = dayStart.getUTCDay();

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
    // GAP DE AUDITORIA FECHADO (Rodada 11): sem teto, uma agenda lotada (ou
    // spam intencional de agendamentos) fazia este endpoint PÚBLICO materializar
    // o dia inteiro e rodar o scan de sobreposição em memória sem limite —
    // amplificação de CPU/memória anônima. Um profissional não atende fisicamente
    // mais que ~200 agendamentos reais em um único dia; acima disso é anomalia.
    take: 200,
  });

  const durationMinutes = service.estimatedDurationMinutes;
  const startMinutes = parseHHMM(workingHours.startTime);
  const endMinutes = parseHHMM(workingHours.endTime);
  const now = new Date();

  const freeSlots: string[] = [];
  for (let candidateStart = startMinutes; candidateStart + durationMinutes <= endMinutes; candidateStart += SLOT_STEP_MINUTES) {
    const slotStart = new Date(Date.UTC(year, month - 1, day, 0, candidateStart, 0, 0));
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
  professionalId: z.string().min(1).max(100),
  serviceId: z.string().min(1).max(100),
  scheduledAt: z
    .string()
    .max(40)
    .datetime()
    .refine(isValidIsoDatetimeCalendarDate, "scheduledAt deve ser uma data de calendário válida"),
  clientName: z.string().min(1).max(200),
  clientPhone: z.string().min(8).max(32),
});

publicBookingRouter.post("/public-booking/:tenantSlug/appointments", async (req: Request, res: Response) => {
  try {
    await enforceRateLimit(`public-booking:${req.params.tenantSlug}:create:${req.ip}`, PUBLIC_BOOKING_WRITE_RATE_LIMIT_MAX, PUBLIC_BOOKING_WRITE_RATE_LIMIT_WINDOW_SECONDS);
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

  // GAP DE AUDITORIA FECHADO: esta rota só checava existência de serviço/
  // profissional — nunca revalidava de verdade se o horário pedido cabia no
  // expediente cadastrado (`ProfessionalWorkingHours`) nem se sobrepunha outro
  // agendamento já existente cuja duração ultrapassasse o instante exato do novo
  // (o `@@unique([tenantId, professionalId, scheduledAt])` só protege colisão de
  // timestamp IDÊNTICO, nunca sobreposição de intervalos). Mesmo algoritmo de
  // sobreposição já usado em `/slots` acima, reaplicado aqui no momento da escrita.
  const scheduledAt = new Date(parsed.data.scheduledAt);

  // GAP DE AUDITORIA FECHADO (fa-w4-publicbooking-past-appointment): esta rota
  // nunca checava se `scheduledAt` já tinha passado — diferente de `/slots`, que
  // filtra `slotStart <= now`, um cliente podia agendar diretamente (sem passar
  // pela listagem de horários livres) para QUALQUER instante já decorrido.
  if (scheduledAt.getTime() <= Date.now()) {
    return res.status(422).json({ success: false, data: null, error: { code: "PAST_APPOINTMENT", message: "Não é possível agendar em um horário que já passou." } });
  }

  const durationMinutes = service.estimatedDurationMinutes;
  const appointmentEnd = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
  // Política de fuso UTC (ver comentário acima de `isValidCalendarDate`): mesma
  // interpretação de "dia da semana"/"hora do dia" usada em `/slots`, nunca os
  // getters locais (`getDay`/`getHours`/...), que dependem do fuso do processo Node.
  const dayOfWeek = scheduledAt.getUTCDay();

  const workingHours = await prisma.professionalWorkingHours.findUnique({
    where: { tenantId_professionalId_dayOfWeek: { tenantId: tenant.id, professionalId: professional.id, dayOfWeek } },
  });
  if (!workingHours) {
    return res.status(422).json({ success: false, data: null, error: { code: "OUTSIDE_WORKING_HOURS", message: "Profissional não possui expediente cadastrado para este dia." } });
  }
  const startMinutes = parseHHMM(workingHours.startTime);
  const endMinutes = parseHHMM(workingHours.endTime);
  const scheduledMinutes = scheduledAt.getUTCHours() * 60 + scheduledAt.getUTCMinutes();
  if (scheduledMinutes < startMinutes || scheduledMinutes + durationMinutes > endMinutes) {
    return res.status(422).json({ success: false, data: null, error: { code: "OUTSIDE_WORKING_HOURS", message: "Horário fora do expediente do profissional." } });
  }

  const dayStart = new Date(Date.UTC(scheduledAt.getUTCFullYear(), scheduledAt.getUTCMonth(), scheduledAt.getUTCDate(), 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(scheduledAt.getUTCFullYear(), scheduledAt.getUTCMonth(), scheduledAt.getUTCDate(), 23, 59, 59, 999));

  try {
    const appointment = await prisma.$transaction(
      async (tx) => {
        // Revalidação de sobreposição DENTRO da mesma transação Serializable que
        // faz a escrita — nunca um SELECT fora da transação seguido de um INSERT
        // separado (TOCTOU clássico entre duas requisições concorrentes para o
        // mesmo profissional/horário que não colidem em timestamp exato).
        const existingAppointments = await tx.appointment.findMany({
          where: {
            tenantId: tenant.id,
            professionalId: professional.id,
            scheduledAt: { gte: dayStart, lte: dayEnd },
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
          },
          select: { scheduledAt: true, durationMinutes: true },
          take: 200,
        });
        const hasOverlap = existingAppointments.some((appt) => {
          const apptStart = appt.scheduledAt;
          const apptEnd = new Date(apptStart.getTime() + appt.durationMinutes * 60_000);
          return scheduledAt < apptEnd && apptStart < appointmentEnd;
        });
        if (hasOverlap) {
          throw new Error("SLOT_OVERLAP");
        }

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
            scheduledAt,
            durationMinutes: service.estimatedDurationMinutes,
            source: "PUBLIC_BOOKING",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return res.status(201).json({ success: true, data: appointment, error: null });
  } catch (err: any) {
    if (err?.code === "P2002" || err?.message === "SLOT_OVERLAP") {
      return res.status(409).json({ success: false, data: null, error: { code: "SLOT_ALREADY_TAKEN", message: "Este horário acabou de ser reservado por outro cliente. Escolha outro horário." } });
    }
    throw err;
  }
});
