// apps/api/src/modules/client-records/client-records.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 5 — "PETSHOP/VETERINÁRIA —
// PRONTUÁRIO" (`Pet`/`VaccineRecord`), "SETOR AUTOMOTIVO — VEÍCULO"
// (`Vehicle`), "SETOR AUTOMOTIVO — LOJA DE VEÍCULOS SEMINOVOS"
// (`VehicleListing`) e "ÓTICA — RECEITA DE GRAU" (`OpticalPrescription`).
// GAP DE AUDITORIA ENCONTRADO: os cinco models existiam no schema (`Pet`/
// `Vehicle` já eram referenciados como FK opcional em `Appointment`, Capítulo
// 4.2/4.7), mas nenhum nunca teve rota REST própria.
// Reaproveita "crm:client:read"/"crm:client:write" — todos são registros
// subordinados a um Client (prontuário de pet, veículo, receita de grau),
// mesmo domínio RBAC do cadastro de cliente, nunca um domínio novo.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";
import { notifyTenant } from "../notifications/notify.service";
import { lookupVehicleByPlate } from "../integrations/vehicle-plate-lookup.service";
import { readEnumQuery } from "../../lib/query-enum";

export const clientRecordsRouter = Router();

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
async function requireRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:client:read"))) {
    forbid(res, "Seu nível de acesso não permite consultar prontuários/registros de clientes.");
    return false;
  }
  return true;
}
async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:client:write"))) {
    forbid(res, "Seu nível de acesso não permite editar prontuários/registros de clientes.");
    return false;
  }
  return true;
}

// ───────────────────────── Pet / VaccineRecord (Petshop/Veterinária) ─────────────────────────

const petSchema = z.object({
  ownerId: z.string().min(1),
  name: z.string().min(1),
  species: z.string().min(1),
  breed: z.string().optional(),
  birthDate: z.string().datetime().optional(),
  weightKg: z.number().positive().optional(),
});

const petsQuerySchema = z.object({ ownerId: z.string().uuid().optional() });

clientRecordsRouter.get("/pets", requireAuth, requireModule("PETSHOP_VET"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-client-records-filters-unvalidated): `ownerId`
  // era lido via cast direto (`as string | undefined`), sem checar formato — um
  // valor malformado batia direto no Prisma (500 genérico em vez de 400 claro).
  const parsedQuery = petsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsedQuery.error.flatten() } });
  const { ownerId } = parsedQuery.data;
  const { tenantId } = req.session!;
  const pets = await prisma.pet.findMany({ where: { tenantId, ...(ownerId ? { ownerId } : {}) }, orderBy: { name: "asc" }, take: 500 });
  return res.json({ success: true, data: pets, error: null });
});

clientRecordsRouter.get("/pets/:id", requireAuth, requireModule("PETSHOP_VET"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const pet = await prisma.pet.findFirst({ where: { id: req.params.id, tenantId }, include: { vaccineRecords: { orderBy: { appliedAt: "desc" } }, owner: { select: { id: true, name: true } } } });
  if (!pet) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pet não encontrado." } });
  return res.json({ success: true, data: pet, error: null });
});

// Capítulo 11.3 — Petshop/Veterinária: CRM consolidado do pet — tela única com
// histórico de vacinas, agendamentos (banho/tosa/consulta) e compras do tutor
// (Sale/SaleItem não têm FK direta para Pet; o elo real do nicho é o cliente dono
// do pet, mesmo padrão de "prontuário por cliente" já usado em Vehicle/
// OpticalPrescription — GAP DE AUDITORIA FECHADO: os três históricos já existiam
// individualmente, mas nenhuma tela/endpoint os consolidava).
clientRecordsRouter.get("/pets/:id/crm-summary", requireAuth, requireModule("PETSHOP_VET"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const pet = await prisma.pet.findFirst({ where: { id: req.params.id, tenantId }, include: { owner: { select: { id: true, name: true, phone: true, email: true } } } });
  if (!pet) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pet não encontrado." } });
  const [vaccineRecords, appointments, sales] = await Promise.all([
    // CORREÇÃO DE AUDITORIA (mega-audit rodada 7, ALTO): sem `take`, um pet com anos
    // de histórico (vacinas anuais + banho/tosa mensal) devolvia a lista INTEIRA
    // nesta tela de resumo — que é um CRM consolidado, não uma tela de histórico
    // completo paginado. Limitado aos registros mais recentes, mesmo teto já usado
    // para `sales` logo abaixo.
    prisma.vaccineRecord.findMany({ where: { tenantId, petId: pet.id }, orderBy: { appliedAt: "desc" }, take: 50 }),
    prisma.appointment.findMany({
      where: { tenantId, petId: pet.id },
      include: { service: { select: { id: true, name: true } }, professional: { select: { id: true, name: true } } },
      orderBy: { scheduledAt: "desc" },
      take: 50,
    }),
    prisma.sale.findMany({
      where: { tenantId, clientId: pet.ownerId },
      include: { items: { select: { id: true, productId: true, serviceId: true, quantity: true, totalPrice: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return res.json({
    success: true,
    data: { pet, vaccineRecords, appointments, purchases: sales },
    error: null,
  });
});

clientRecordsRouter.post("/pets", requireAuth, requireModule("PETSHOP_VET"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = petSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  // CORREÇÃO DE AUDITORIA: ownerId vinha do body sem validar que o Client
  // pertence a este tenant (FK injection cross-tenant).
  const owner = await prisma.client.findFirst({ where: { id: parsed.data.ownerId, tenantId } });
  if (!owner) return res.status(404).json({ success: false, data: null, error: { code: "OWNER_NOT_FOUND", message: "Cliente (tutor) não encontrado neste tenant." } });
  const pet = await prisma.pet.create({
    data: { tenantId, ownerId: parsed.data.ownerId, name: parsed.data.name, species: parsed.data.species, breed: parsed.data.breed, birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined, weightKg: parsed.data.weightKg },
  });
  return res.status(201).json({ success: true, data: pet, error: null });
});

clientRecordsRouter.patch("/pets/:id", requireAuth, requireModule("PETSHOP_VET"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = petSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  const existing = await prisma.pet.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pet não encontrado." } });
  if (parsed.data.ownerId) {
    const owner = await prisma.client.findFirst({ where: { id: parsed.data.ownerId, tenantId } });
    if (!owner) return res.status(404).json({ success: false, data: null, error: { code: "OWNER_NOT_FOUND", message: "Cliente (tutor) não encontrado neste tenant." } });
  }
  const pet = await prisma.pet.update({
    where: { id: existing.id },
    data: { ...parsed.data, birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined },
  });
  return res.json({ success: true, data: pet, error: null });
});

const vaccineSchema = z.object({ vaccineName: z.string().min(1), appliedAt: z.string().datetime(), nextDoseDueAt: z.string().datetime().optional() });

clientRecordsRouter.get("/pets/:petId/vaccine-records", requireAuth, requireModule("PETSHOP_VET"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const records = await prisma.vaccineRecord.findMany({ where: { tenantId, petId: req.params.petId }, orderBy: { appliedAt: "desc" }, take: 200 });
  return res.json({ success: true, data: records, error: null });
});

clientRecordsRouter.post("/pets/:petId/vaccine-records", requireAuth, requireModule("PETSHOP_VET"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = vaccineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId, userId } = req.session!;
  const pet = await prisma.pet.findFirst({ where: { id: req.params.petId, tenantId } });
  if (!pet) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pet não encontrado." } });
  const record = await prisma.vaccineRecord.create({
    data: { tenantId, petId: pet.id, vaccineName: parsed.data.vaccineName, appliedAt: new Date(parsed.data.appliedAt), nextDoseDueAt: parsed.data.nextDoseDueAt ? new Date(parsed.data.nextDoseDueAt) : undefined, appliedByUserId: userId },
  });
  return res.status(201).json({ success: true, data: record, error: null });
});

const withinDaysQuerySchema = z.object({ withinDays: z.coerce.number().int().min(0).max(3650).default(7) });

// Agenda de reforço de vacina — alimenta o mesmo motor central de notificações
// (Capítulo 8.4.5) usado pela sugestão de reposição de estoque (17.8.3): aqui
// apenas consulta sob demanda; o job diário que dispara `emitNotification()`
// automaticamente ainda não está registrado (mesma pendência já documentada
// para o BullMQ de reposição de estoque).
clientRecordsRouter.get("/vaccine-records/due-soon", requireAuth, requireModule("PETSHOP_VET"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-numeric-input-not-validated): `withinDays` era
  // lido via `Number()` cru, sem bounds — um valor não numérico virava `NaN`
  // (threshold `Invalid Date`, filtro Prisma quebrado) e um valor absurdamente alto
  // negativo/positivo nunca era rejeitado.
  const parsedQuery = withinDaysQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsedQuery.error.flatten() } });
  const { tenantId } = req.session!;
  const threshold = new Date(Date.now() + parsedQuery.data.withinDays * 24 * 60 * 60 * 1000);
  const records = await prisma.vaccineRecord.findMany({
    where: { tenantId, nextDoseDueAt: { not: null, lte: threshold } },
    include: { pet: { select: { id: true, name: true, ownerId: true } } },
    orderBy: { nextDoseDueAt: "asc" },
    take: 500,
  });
  return res.json({ success: true, data: records, error: null });
});

// Capítulo 11.3 — Petshop/Veterinária: GAP DE AUDITORIA FECHADO — `due-soon` acima já
// existia (consulta sob demanda), mas nenhum caminho real disparava o lembrete
// automático ao tutor quando a próxima dose se aproxima. Reaproveita o motor central
// de notificações (`notifyTenant`, Capítulo 8.4) — o fan-out real por WhatsApp/SMS
// (Capítulo 20.2/20.8) permanece pendente de um worker dedicado (mesma pendência já
// documentada em `notify.service.ts`/Rodada 4 para toda notificação do sistema; este
// endpoint só garante que a notificação INTERNA é criada de fato, sem fabricar um
// envio externo que ainda não existe). Idempotente via `reminderSentAt`: uma dose
// só é lembrada uma vez, até a data mudar (nova aplicação zera o campo).
const withinDaysBodySchema = z.object({ withinDays: z.coerce.number().int().min(0).max(3650).default(7) });

clientRecordsRouter.post("/vaccine-records/notify-due-soon", requireAuth, requireModule("PETSHOP_VET"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-numeric-input-not-validated): mesma falta de
  // validação do GET /vaccine-records/due-soon acima, só que no body.
  const parsedBody = withinDaysBodySchema.safeParse(req.body ?? {});
  if (!parsedBody.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsedBody.error.flatten() } });
  const { tenantId } = req.session!;
  const threshold = new Date(Date.now() + parsedBody.data.withinDays * 24 * 60 * 60 * 1000);
  const records = await prisma.vaccineRecord.findMany({
    where: { tenantId, nextDoseDueAt: { not: null, lte: threshold }, reminderSentAt: null },
    include: { pet: { select: { id: true, name: true, ownerId: true, owner: { select: { name: true, phone: true } } } } },
    orderBy: { nextDoseDueAt: "asc" },
    take: 500,
  });
  const notified: string[] = [];
  for (const record of records) {
    await notifyTenant({
      tenantId,
      category: "VACCINE_REMINDER",
      title: `Vacina ${record.vaccineName} vencendo para ${record.pet.name}`,
      body: `Tutor ${record.pet.owner.name} (${record.pet.owner.phone ?? "sem telefone cadastrado"}): próxima dose de ${record.vaccineName} do pet ${record.pet.name} prevista para ${record.nextDoseDueAt?.toLocaleDateString("pt-BR")}.`,
      severity: "INFO",
      linkRoute: `/petshop/pets/${record.pet.id}`,
      sourceType: "VACCINE_RECORD",
      sourceId: record.id,
      // fa-w5-notif-no-marketing-optout-enforcement — dispara também o fan-out
      // externo (WhatsApp/e-mail) diretamente ao TUTOR do pet (`Client`), não só o
      // registro in-app visto pelo staff do tenant. VACCINE_REMINDER é classificado
      // TRANSACTIONAL (lembrete de saúde/segurança do próprio pet do cliente) em
      // notify.service.ts — nunca bloqueado por falta de opt-in de marketing.
      recipientClientId: record.pet.ownerId,
    });
    await prisma.vaccineRecord.update({ where: { id: record.id }, data: { reminderSentAt: new Date() } });
    notified.push(record.id);
  }
  return res.json({ success: true, data: { notifiedCount: notified.length, notifiedVaccineRecordIds: notified }, error: null });
});

// ───────────────────────── Vehicle (prontuário de veículo do cliente) ─────────────────────────

const vehicleSchema = z.object({
  ownerId: z.string().min(1),
  licensePlate: z.string().min(1),
  chassisNumber: z.string().optional(),
  model: z.string().min(1),
  manufactureYear: z.number().int().optional(),
  mileageKm: z.number().int().optional(),
});

const vehiclesQuerySchema = z.object({
  ownerId: z.string().uuid().optional(),
  licensePlate: z.string().trim().min(1).max(10).optional(),
});

clientRecordsRouter.get("/vehicles", requireAuth, requireModule("AUTO_REPAIR_SHOP"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-client-records-filters-unvalidated): `ownerId`/
  // `licensePlate` eram lidos via cast direto (`as Record<string, string|undefined>`).
  const parsedQuery = vehiclesQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsedQuery.error.flatten() } });
  const { ownerId, licensePlate } = parsedQuery.data;
  const { tenantId } = req.session!;
  const vehicles = await prisma.vehicle.findMany({ where: { tenantId, ...(ownerId ? { ownerId } : {}), ...(licensePlate ? { licensePlate } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
  return res.json({ success: true, data: vehicles, error: null });
});

// Capítulo 11.9 — consulta automática pela placa (API Placa Fipe), disparada pelo
// frontend no onBlur do campo de placa em /clientes/veiculos/novo. Sem credencial
// VEHICLE_DATA_FIPE_PLACA ativa, retorna data:null (cadastro segue 100% manual).
clientRecordsRouter.get("/vehicles/lookup-plate/:plate", requireAuth, requireModule("AUTO_REPAIR_SHOP"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const result = await lookupVehicleByPlate(tenantId, req.params.plate);
  return res.json({ success: true, data: result, error: null });
});

clientRecordsRouter.get("/vehicles/:id", requireAuth, requireModule("AUTO_REPAIR_SHOP"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.id, tenantId }, include: { owner: { select: { id: true, name: true } }, workOrders: { select: { id: true, status: true, createdAt: true } } } });
  if (!vehicle) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Veículo não encontrado." } });
  return res.json({ success: true, data: vehicle, error: null });
});

clientRecordsRouter.post("/vehicles", requireAuth, requireModule("AUTO_REPAIR_SHOP"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  // CORREÇÃO DE AUDITORIA: ownerId vinha do body sem validar que o Client
  // pertence a este tenant (FK injection cross-tenant).
  const owner = await prisma.client.findFirst({ where: { id: parsed.data.ownerId, tenantId } });
  if (!owner) return res.status(404).json({ success: false, data: null, error: { code: "OWNER_NOT_FOUND", message: "Cliente (proprietário) não encontrado neste tenant." } });
  try {
    const vehicle = await prisma.vehicle.create({ data: { tenantId, ...parsed.data } });
    return res.status(201).json({ success: true, data: vehicle, error: null });
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ success: false, data: null, error: { code: "LICENSE_PLATE_ALREADY_EXISTS", message: "Já existe um veículo cadastrado com esta placa neste tenant." } });
    throw err;
  }
});

clientRecordsRouter.patch("/vehicles/:id", requireAuth, requireModule("AUTO_REPAIR_SHOP"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = vehicleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  const existing = await prisma.vehicle.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Veículo não encontrado." } });
  if (parsed.data.ownerId) {
    const owner = await prisma.client.findFirst({ where: { id: parsed.data.ownerId, tenantId } });
    if (!owner) return res.status(404).json({ success: false, data: null, error: { code: "OWNER_NOT_FOUND", message: "Cliente (proprietário) não encontrado neste tenant." } });
  }
  const vehicle = await prisma.vehicle.update({ where: { id: existing.id }, data: parsed.data });
  return res.json({ success: true, data: vehicle, error: null });
});

// ───────────────────────── VehicleListing (loja de seminovos, estoque por chassi) ─────────────────────────
// Capítulo 11.12 — "Portais de anúncio" (OLX/Webmotors/iCarros): publicação
// automática DIFERIDA nesta rodada — não há API pública homologada disponível
// sem acordo comercial prévio com cada portal (mesmo padrão de outros envios
// automáticos já adiados em rodadas anteriores). Nenhum código de integração
// foi escrito; ver resumo da rodada para detalhes.

const listingSchema = z.object({
  chassisNumber: z.string().min(1),
  licensePlate: z.string().optional(),
  model: z.string().min(1),
  manufactureYear: z.number().int(),
  mileageKm: z.number().int(),
  askingPrice: z.number().positive(),
  consignorClientId: z.string().optional(),
  consignmentCommissionPercentage: z.number().min(0).max(100).optional(),
  // Capítulo 11.12 — consignação/documentação: preenchíveis desde o cadastro ou
  // só no momento da venda (via PATCH .../mark-sold, que também os aceita).
  consignorPayoutAmount: z.number().nonnegative().optional(),
  actualSalePrice: z.number().positive().optional(),
  atpveIssuedAt: z.string().datetime().optional(),
  detranCommunicationProtocol: z.string().min(1).optional(),
});

clientRecordsRouter.get("/vehicle-listings", requireAuth, requireModule("VEHICLE_DEALERSHIP"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const statusParsed = readEnumQuery(res, req.query.status, ["AVAILABLE", "RESERVED", "SOLD", "CONSIGNED"] as const, "status");
  if (!statusParsed.ok) return;
  const listings = await prisma.vehicleListing.findMany({ where: { tenantId, ...(statusParsed.value ? { status: statusParsed.value } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
  return res.json({ success: true, data: listings, error: null });
});

clientRecordsRouter.get("/vehicle-listings/:id", requireAuth, requireModule("VEHICLE_DEALERSHIP"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const listing = await prisma.vehicleListing.findFirst({ where: { id: req.params.id, tenantId }, include: { consignorClient: { select: { id: true, name: true } } } });
  if (!listing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Anúncio de veículo não encontrado." } });
  return res.json({ success: true, data: listing, error: null });
});

clientRecordsRouter.post("/vehicle-listings", requireAuth, requireModule("VEHICLE_DEALERSHIP"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = listingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  if (parsed.data.consignorClientId && parsed.data.consignmentCommissionPercentage === undefined) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Veículo consignado exige percentual de comissão definido." } });
  }
  if (parsed.data.consignorClientId) {
    // CORREÇÃO DE AUDITORIA: consignorClientId vinha do body sem validar tenant.
    const consignor = await prisma.client.findFirst({ where: { id: parsed.data.consignorClientId, tenantId } });
    if (!consignor) return res.status(404).json({ success: false, data: null, error: { code: "CONSIGNOR_NOT_FOUND", message: "Cliente consignante não encontrado neste tenant." } });
  }
  try {
    const { atpveIssuedAt, ...rest } = parsed.data;
    const listing = await prisma.vehicleListing.create({
      data: { tenantId, ...rest, ...(atpveIssuedAt ? { atpveIssuedAt: new Date(atpveIssuedAt) } : {}) },
    });
    return res.status(201).json({ success: true, data: listing, error: null });
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ success: false, data: null, error: { code: "CHASSIS_ALREADY_EXISTS", message: "Já existe um anúncio para este chassi neste tenant." } });
    throw err;
  }
});

clientRecordsRouter.patch("/vehicle-listings/:id", requireAuth, requireModule("VEHICLE_DEALERSHIP"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = listingSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  const existing = await prisma.vehicleListing.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Anúncio de veículo não encontrado." } });
  if (parsed.data.consignorClientId) {
    const consignor = await prisma.client.findFirst({ where: { id: parsed.data.consignorClientId, tenantId } });
    if (!consignor) return res.status(404).json({ success: false, data: null, error: { code: "CONSIGNOR_NOT_FOUND", message: "Cliente consignante não encontrado neste tenant." } });
  }
  const { atpveIssuedAt, ...rest } = parsed.data;
  const listing = await prisma.vehicleListing.update({
    where: { id: existing.id },
    data: { ...rest, ...(atpveIssuedAt ? { atpveIssuedAt: new Date(atpveIssuedAt) } : {}) },
  });
  return res.json({ success: true, data: listing, error: null });
});

// Venda do veículo seminovo — transição de estado simples (não cria Sale/SaleItem
// do PDV; veículo seminovo é negociado fora do fluxo de caixa de balcão,
// documentado explicitamente como escopo distinto do Capítulo 6). Aceita, no
// corpo, o fechamento da negociação (preço efetivo/repasse/documentação) para o
// caso comum de esses valores só serem definidos na hora da venda — nunca
// obrigatório, pois o cadastro já pode tê-los preenchido antes.
const markSoldSchema = z.object({
  actualSalePrice: z.number().positive().optional(),
  consignorPayoutAmount: z.number().nonnegative().optional(),
  atpveIssuedAt: z.string().datetime().optional(),
  detranCommunicationProtocol: z.string().min(1).optional(),
});

clientRecordsRouter.patch("/vehicle-listings/:id/mark-sold", requireAuth, requireModule("VEHICLE_DEALERSHIP"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = markSoldSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  const existing = await prisma.vehicleListing.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Anúncio de veículo não encontrado." } });
  if (existing.status === "SOLD") return res.status(409).json({ success: false, data: null, error: { code: "ALREADY_SOLD", message: "Este veículo já consta como vendido." } });

  // Capítulo 11.12 — consignação: "nenhuma conta a pagar ao consignante é gerada
  // até a venda efetiva, quando então o valor combinado é registrado como
  // pagável" — por isso o VehicleConsignmentPayout só nasce AQUI, dentro da
  // mesma transação que marca o veículo como vendido, nunca antes.
  const result = await prisma.$transaction(async (tx) => {
    const listing = await tx.vehicleListing.update({
      where: { id: existing.id },
      data: {
        status: "SOLD",
        soldAt: new Date(),
        ...(parsed.data.actualSalePrice !== undefined ? { actualSalePrice: parsed.data.actualSalePrice } : {}),
        ...(parsed.data.consignorPayoutAmount !== undefined ? { consignorPayoutAmount: parsed.data.consignorPayoutAmount } : {}),
        ...(parsed.data.atpveIssuedAt !== undefined ? { atpveIssuedAt: new Date(parsed.data.atpveIssuedAt) } : {}),
        ...(parsed.data.detranCommunicationProtocol !== undefined ? { detranCommunicationProtocol: parsed.data.detranCommunicationProtocol } : {}),
      },
    });

    let payout = null;
    if (listing.consignorClientId && listing.consignorPayoutAmount && !listing.consignorPayoutAmount.isZero()) {
      payout = await tx.vehicleConsignmentPayout.create({
        data: {
          tenantId,
          vehicleListingId: listing.id,
          consignorClientId: listing.consignorClientId,
          payoutAmount: listing.consignorPayoutAmount,
          status: "PENDING",
        },
      });
    }
    return { listing, payout };
  });

  return res.json({ success: true, data: result, error: null });
});

// Baixa manual do repasse ao consignante (o pagamento em si acontece fora do
// sistema — PIX/TED combinado com o consignante — este endpoint só registra que
// já foi pago, mesmo padrão de outros "mark-paid" manuais do financeiro).
clientRecordsRouter.patch("/vehicle-listings/:id/mark-payout-paid", requireAuth, requireModule("VEHICLE_DEALERSHIP"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const { tenantId } = req.session!;
  const listing = await prisma.vehicleListing.findFirst({ where: { id: req.params.id, tenantId } });
  if (!listing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Anúncio de veículo não encontrado." } });
  const payout = await prisma.vehicleConsignmentPayout.findUnique({ where: { vehicleListingId: listing.id } });
  if (!payout || payout.tenantId !== tenantId) {
    return res.status(404).json({ success: false, data: null, error: { code: "PAYOUT_NOT_FOUND", message: "Este anúncio não tem repasse de consignação pendente." } });
  }
  if (payout.status === "PAID") return res.status(409).json({ success: false, data: null, error: { code: "ALREADY_PAID", message: "Este repasse já consta como pago." } });
  const updated = await prisma.vehicleConsignmentPayout.update({ where: { id: payout.id }, data: { status: "PAID", paidAt: new Date() } });
  return res.json({ success: true, data: updated, error: null });
});

// Capítulo 11.12 — consulta do repasse vinculado a um anúncio (null se o
// veículo não é consignado ou ainda não foi vendido).
clientRecordsRouter.get("/vehicle-listings/:id/consignment-payout", requireAuth, requireModule("VEHICLE_DEALERSHIP"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const listing = await prisma.vehicleListing.findFirst({ where: { id: req.params.id, tenantId } });
  if (!listing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Anúncio de veículo não encontrado." } });
  const payout = await prisma.vehicleConsignmentPayout.findUnique({ where: { vehicleListingId: listing.id } });
  return res.json({ success: true, data: payout ?? null, error: null });
});

// ───────────────────────── OpticalPrescription (Ótica) ─────────────────────────

const opticalPrescriptionSchema = z.object({
  clientId: z.string().min(1),
  prescribingDoctor: z.string().min(1),
  // Capítulo 11.2 — Ótica (Decreto 24.492/1934, "livro de registro de receitas"):
  // GAP DE AUDITORIA FECHADO (Rodada 6) — o Decreto exige identificação do
  // profissional prescritor (CRM/CRO, distinto do nome em texto livre já existente
  // em `prescribingDoctor`) e o endereço do cliente no momento do registro (Client
  // não possui campo de endereço próprio — snapshot ponto-no-tempo aqui).
  doctorRegistrationNumber: z.string().min(1),
  clientAddressSnapshot: z.string().min(1),
  rightEyeSphere: z.number(),
  rightEyeCylinder: z.number(),
  rightEyeAxis: z.number().int(),
  leftEyeSphere: z.number(),
  leftEyeCylinder: z.number(),
  leftEyeAxis: z.number().int(),
  addition: z.number().optional(),
  pupillaryDistance: z.number().optional(),
});

const opticalPrescriptionsQuerySchema = z.object({ clientId: z.string().uuid().optional() });

clientRecordsRouter.get("/optical-prescriptions", requireAuth, requireModule("OPTICAL_LAB"), async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-client-records-filters-unvalidated): `clientId`
  // era lido via cast direto (`as string | undefined`).
  const parsedQuery = opticalPrescriptionsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsedQuery.error.flatten() } });
  const { clientId } = parsedQuery.data;
  const { tenantId } = req.session!;
  const prescriptions = await prisma.opticalPrescription.findMany({ where: { tenantId, ...(clientId ? { clientId } : {}) }, orderBy: { registeredAt: "desc" }, take: 500 });
  return res.json({ success: true, data: prescriptions, error: null });
});

clientRecordsRouter.post("/optical-prescriptions", requireAuth, requireModule("OPTICAL_LAB"), async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = opticalPrescriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  // CORREÇÃO DE AUDITORIA: clientId vinha do body sem validar tenant.
  const client = await prisma.client.findFirst({ where: { id: parsed.data.clientId, tenantId } });
  if (!client) return res.status(404).json({ success: false, data: null, error: { code: "CLIENT_NOT_FOUND", message: "Cliente não encontrado neste tenant." } });
  // Capítulo 11.2 — Ótica (Decreto 24.492/1934): `prescriptionNumber` sequencial POR
  // TENANT — mesmo padrão de retry-on-P2002 já usado para `INV-AAAA-NNN`
  // (inventário, Rodada 3 item 7), nunca um UUID: o livro de registro exige
  // numeração legível e ordenada, sem furos criados por corrida concorrente.
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await prisma.opticalPrescription.findFirst({ where: { tenantId }, orderBy: { prescriptionNumber: "desc" }, select: { prescriptionNumber: true } });
    const nextNumber = (last?.prescriptionNumber ?? 0) + 1;
    try {
      const prescription = await prisma.opticalPrescription.create({ data: { tenantId, prescriptionNumber: nextNumber, ...parsed.data } });
      return res.status(201).json({ success: true, data: prescription, error: null });
    } catch (err: any) {
      if (err?.code === "P2002") continue; // outra requisição concorrente levou este número — tenta o próximo
      throw err;
    }
  }
  return res.status(409).json({ success: false, data: null, error: { code: "PRESCRIPTION_NUMBER_CONFLICT", message: "Não foi possível gerar um número de receita único após múltiplas tentativas. Tente novamente." } });
});
