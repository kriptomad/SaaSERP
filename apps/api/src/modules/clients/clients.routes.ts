// apps/api/src/modules/clients/clients.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 5 (schema `Client`) — GAP DE AUDITORIA
// ENCONTRADO E CORRIGIDO: `Client` existe no schema desde o início (referenciado por
// `Sale.clientId`, `WorkOrder.clientId`, conta-corrente de cascos do Capítulo 4.1.3
// etc.), e as permissões RBAC "crm:client:read"/"crm:client:write" já estavam
// seedadas, mas nenhuma rota REST jamais existiu — o PDV/O.S. não tinham como
// buscar ou cadastrar um cliente.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const clientsRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

clientsRouter.get("/clients", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:client:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar clientes." } });
  }

  const search = typeof req.query.search === "string" ? req.query.search : null;
  const clients = await prisma.client.findMany({
    where: {
      tenantId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { document: { contains: search } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 50,
  });

  return res.json({ success: true, data: clients, error: null });
});

clientsRouter.get("/clients/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:client:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar clientes." } });
  }
  const client = await prisma.client.findFirst({ where: { id: req.params.id, tenantId } });
  if (!client) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Cliente não encontrado." } });
  }
  return res.json({ success: true, data: client, error: null });
});

const createClientSchema = z.object({
  name: z.string().min(2),
  document: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  creditLimit: z.number().nonnegative().default(0),
  // Capítulo 4.3 — Adega/Bebidas: seleciona o Preço Revenda na precificação em cascata.
  isReseller: z.boolean().optional().default(false),
  // Capítulo 11.8 — Material de Construção/Ferragens: perfil de cliente profissional
  // (construtora/empreiteiro) que habilita limite de crédito mais alto e faturamento
  // mensal consolidado (apps/api/src/modules/construction/business-accounts.routes.ts)
  // em vez de cobrança por venda individual.
  isBusinessAccount: z.boolean().optional().default(false),
  // Capítulo 11.2 — Ótica: vínculo opcional a convênio/plano de saúde, usado para
  // habilitar vendas `paymentMethod = HEALTH_INSURANCE` (close-sale.service.ts).
  healthInsurancePlanId: z.string().nullable().optional(),
  healthInsurancePlanMemberId: z.string().nullable().optional(),
});

clientsRouter.post("/clients", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:client:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite cadastrar clientes." } });
  }

  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  if (input.document) {
    const existing = await prisma.client.findFirst({ where: { tenantId, document: input.document } });
    if (existing) {
      return res.status(409).json({ success: false, data: null, error: { code: "DOCUMENT_TAKEN", message: "Já existe um cliente com este CPF/CNPJ." } });
    }
  }
  // CORREÇÃO DE AUDITORIA: healthInsurancePlanId vinha do body sem validar tenant.
  if (input.healthInsurancePlanId) {
    const plan = await prisma.healthInsurancePlan.findFirst({ where: { id: input.healthInsurancePlanId, tenantId } });
    if (!plan) return res.status(404).json({ success: false, data: null, error: { code: "HEALTH_INSURANCE_PLAN_NOT_FOUND", message: "Convênio não encontrado neste tenant." } });
  }

  const client = await prisma.client.create({
    data: {
      tenantId,
      name: input.name,
      document: input.document ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      creditLimit: input.creditLimit,
      isReseller: input.isReseller,
      isBusinessAccount: input.isBusinessAccount,
      healthInsurancePlanId: input.healthInsurancePlanId ?? null,
      healthInsurancePlanMemberId: input.healthInsurancePlanMemberId ?? null,
    },
  });

  return res.status(201).json({ success: true, data: client, error: null });
});

const updateClientSchema = createClientSchema.partial();

clientsRouter.patch("/clients/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:client:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite editar clientes." } });
  }

  const existing = await prisma.client.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Cliente não encontrado." } });
  }

  const parsed = updateClientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;
  if (input.healthInsurancePlanId) {
    const plan = await prisma.healthInsurancePlan.findFirst({ where: { id: input.healthInsurancePlanId, tenantId } });
    if (!plan) return res.status(404).json({ success: false, data: null, error: { code: "HEALTH_INSURANCE_PLAN_NOT_FOUND", message: "Convênio não encontrado neste tenant." } });
  }

  const client = await prisma.client.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.document !== undefined ? { document: input.document } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
      ...(input.isReseller !== undefined ? { isReseller: input.isReseller } : {}),
      ...(input.isBusinessAccount !== undefined ? { isBusinessAccount: input.isBusinessAccount } : {}),
      ...(input.healthInsurancePlanId !== undefined ? { healthInsurancePlanId: input.healthInsurancePlanId } : {}),
      ...(input.healthInsurancePlanMemberId !== undefined ? { healthInsurancePlanMemberId: input.healthInsurancePlanMemberId } : {}),
    },
  });

  return res.json({ success: true, data: client, error: null });
});
