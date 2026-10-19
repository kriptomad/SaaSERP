// apps/api/src/modules/work-orders/work-orders.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.2 (Assistência Técnica/Informática —
// Ordens de Serviço) + Capítulo 6.4 (aprovação de orçamento com lock otimista).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: os modelos `WorkOrder`,
// `WorkOrderItem`, `OsChecklist`, `OsPhoto` existem no schema desde o início, e
// `approve-budget.service.ts` já implementava a aprovação via token de uso
// único (Capítulo 6.4), mas NENHUMA rota REST jamais existiu para todo o ciclo
// de vida de uma O.S. — nem para criar, listar, lançar peça/mão de obra,
// orçar, anexar foto/checklist ou entregar o equipamento. O nicho inteiro de
// Assistência Técnica (Capítulo 4.2) não tinha superfície de API alguma.
// Permissões RBAC já seedadas e nunca usadas: "work-order:read",
// "work-order:write", "work-order:approve-budget".
import { randomBytes } from "node:crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma, prismaUnscoped } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";
import { isTenantStorageKey } from "../../lib/storage-key";
import {
  approveBudget,
  BudgetAlreadyProcessedError,
  BudgetExpiredError,
} from "../../services/work-order/approve-budget.service";
import {
  billAndDeliverWorkOrder,
  WorkOrderNotFoundError,
  WorkOrderNotReadyForDeliveryError,
  WorkOrderHasNoBillableItemsError,
  WorkOrderChecklistIncompleteError,
} from "./bill-and-deliver-work-order.service";
import { enqueueFiscalEmission } from "../fiscal/queues/fiscal-emission.queue";
import { notifyTenant } from "../notifications/notify.service";
import { readEnumQuery } from "../../lib/query-enum";

export const workOrdersRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

// Transições de status válidas, lançadas a partir da própria rota PATCH.
// AWAITING_APPROVAL (via POST /:id/budget) e DELIVERED (via POST /:id/deliver)
// têm efeitos colaterais próprios e não podem ser setadas diretamente aqui.
const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ["DIAGNOSING", "CANCELLED"],
  DIAGNOSING: ["RECEIVED", "CANCELLED"],
  AWAITING_APPROVAL: ["CANCELLED"],
  IN_REPAIR: ["READY", "CANCELLED"],
  READY: ["IN_REPAIR"],
  DELIVERED: [],
  CANCELLED: [],
};

workOrdersRouter.get("/work-orders", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar ordens de serviço." } });
  }

  const statusParsed = readEnumQuery(res, req.query.status, ["RECEIVED", "DIAGNOSING", "AWAITING_APPROVAL", "IN_REPAIR", "READY", "DELIVERED", "CANCELLED"] as const, "status");
  if (!statusParsed.ok) return;
  const status = statusParsed.value;
  const assignedTechnicianId = typeof req.query.assignedTechnicianId === "string" ? req.query.assignedTechnicianId : null;

  const workOrders = await prisma.workOrder.findMany({
    where: {
      tenantId,
      ...(status ? { status } : {}),
      ...(assignedTechnicianId ? { assignedTechnicianId } : {}),
    },
    include: {
      client: true,
      assignedTechnician: true,
      // GAP DE AUDITORIA FECHADO (Rodada 13): o `take:100` do pai limitava o
      // número de O.S. retornadas, mas a relação `items` aninhada não tinha
      // teto nenhum — uma única O.S. com milhares de itens lançados (ou um
      // abuso deliberado) inflava a resposta de forma ilimitada mesmo com o
      // teto do pai no lugar.
      items: { take: 200 },
      Vehicle: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return res.json({ success: true, data: workOrders.map(({ budgetApprovalToken: _t, Vehicle, ...wo }) => ({ ...wo, vehicle: Vehicle })), error: null });
});

workOrdersRouter.get("/work-orders/:id", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar ordens de serviço." } });
  }

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      client: true,
      assignedTechnician: true,
      items: { include: { product: true } },
      checklist: true,
      photos: true,
      Vehicle: true,
    },
  });
  if (!workOrder) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Ordem de serviço não encontrada." } });
  }
  // CORREÇÃO DE AUDITORIA: `budgetApprovalToken` é um segredo de uso único (o
  // cliente final aprova o orçamento via link público com este token, sem
  // autenticação) — não pode ser exposto a quem já tem acesso autenticado à
  // O.S., pois permitiria burlar a expectativa de "só quem recebeu o link
  // aprova". Removido da resposta.
  const { budgetApprovalToken: _budgetApprovalToken, Vehicle, ...workOrderRest } = workOrder;
  const workOrderSafe = { ...workOrderRest, vehicle: Vehicle };
  return res.json({ success: true, data: workOrderSafe, error: null });
});

async function technicianBelongsToTenant(technicianId: string | null | undefined, tenantId: string): Promise<boolean> {
  if (!technicianId) return true;
  return (await prisma.user.count({ where: { id: technicianId, tenantId } })) > 0;
}
// 11.9/11.10/11.11 — oficina mecânica, pneus e estética automotiva vinculam a O.S. a um `Vehicle`
// (placa/chassi/km) já cadastrado em client-records. Campo opcional: nichos sem veículo (ex.
// assistência técnica de informática) continuam criando O.S. sem vehicleId normalmente.
async function vehicleBelongsToTenant(vehicleId: string | null | undefined, tenantId: string): Promise<boolean> {
  if (!vehicleId) return true;
  return (await prisma.vehicle.count({ where: { id: vehicleId, tenantId } })) > 0;
}
const createWorkOrderSchema = z.object({
  clientId: z.string().uuid(),
  equipmentDescription: z.string().min(2),
  reportedIssue: z.string().min(2),
  assignedTechnicianId: z.string().uuid().nullable().optional(),
  vehicleId: z.string().uuid().nullable().optional(),
});

workOrdersRouter.post("/work-orders", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite abrir ordens de serviço." } });
  }

  const parsed = createWorkOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: input.clientId, tenantId } });
  if (!client) {
    return res.status(404).json({ success: false, data: null, error: { code: "CLIENT_NOT_FOUND", message: "Cliente não encontrado para este tenant." } });
  }

  if (!(await technicianBelongsToTenant(input.assignedTechnicianId, tenantId))) {
    return res.status(404).json({ success: false, data: null, error: { code: "TECHNICIAN_NOT_FOUND", message: "Técnico não encontrado neste tenant." } });
  }

  if (!(await vehicleBelongsToTenant(input.vehicleId, tenantId))) {
    return res.status(404).json({ success: false, data: null, error: { code: "VEHICLE_NOT_FOUND", message: "Veículo não encontrado neste tenant." } });
  }

  const workOrder = await prisma.workOrder.create({
    data: {
      tenantId,
      clientId: input.clientId,
      equipmentDescription: input.equipmentDescription,
      reportedIssue: input.reportedIssue,
      assignedTechnicianId: input.assignedTechnicianId ?? null,
      vehicleId: input.vehicleId ?? null,
      status: "RECEIVED",
    },
  });

  return res.status(201).json({ success: true, data: workOrder, error: null });
});

const updateWorkOrderSchema = z.object({
  equipmentDescription: z.string().min(2).optional(),
  reportedIssue: z.string().min(2).optional(),
  diagnosisNotes: z.string().nullable().optional(),
  assignedTechnicianId: z.string().uuid().nullable().optional(),
  vehicleId: z.string().uuid().nullable().optional(),
  status: z.enum(["RECEIVED", "DIAGNOSING", "IN_REPAIR", "READY", "CANCELLED"]).optional(),
});

workOrdersRouter.patch("/work-orders/:id", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite editar ordens de serviço." } });
  }

  const existing = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Ordem de serviço não encontrada." } });
  }

  const parsed = updateWorkOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  if (input.status && !ALLOWED_STATUS_TRANSITIONS[existing.status]?.includes(input.status)) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "INVALID_STATUS_TRANSITION", message: `Não é possível mudar de ${existing.status} para ${input.status}.` },
    });
  }

  if (!(await technicianBelongsToTenant(input.assignedTechnicianId, tenantId))) {
    return res.status(404).json({ success: false, data: null, error: { code: "TECHNICIAN_NOT_FOUND", message: "Técnico não encontrado neste tenant." } });
  }

  if (!(await vehicleBelongsToTenant(input.vehicleId, tenantId))) {
    return res.status(404).json({ success: false, data: null, error: { code: "VEHICLE_NOT_FOUND", message: "Veículo não encontrado neste tenant." } });
  }

  const workOrder = await prisma.workOrder.update({
    where: { id: existing.id },
    data: {
      ...(input.equipmentDescription !== undefined ? { equipmentDescription: input.equipmentDescription } : {}),
      ...(input.reportedIssue !== undefined ? { reportedIssue: input.reportedIssue } : {}),
      ...(input.diagnosisNotes !== undefined ? { diagnosisNotes: input.diagnosisNotes } : {}),
      ...(input.assignedTechnicianId !== undefined ? { assignedTechnicianId: input.assignedTechnicianId } : {}),
      ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  if (input.status && input.status !== existing.status) {
    // Capítulo 8.2/8.4 — notifica (grava + empurra via SSE) o técnico responsável e,
    // via broadcast (userId null), qualquer OWNER/MANAGER acompanhando o painel de O.S.
    await notifyTenant({
      tenantId,
      userId: workOrder.assignedTechnicianId ?? null,
      category: "WORK_ORDER_STATUS",
      title: "Status da O.S. atualizado",
      body: `A ordem de serviço #${workOrder.id.slice(0, 8)} mudou para ${input.status}.`,
      severity: "INFO",
      linkRoute: `/os/${workOrder.id}`,
      sourceType: "WORK_ORDER",
      sourceId: workOrder.id,
    }).catch(() => {
      // notifyTenant já loga internamente; status da O.S. nunca pode falhar por isso.
    });
  }

  return res.json({ success: true, data: workOrder, error: null });
});

const addItemSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  description: z.string().min(1),
  itemType: z.enum(["PART", "LABOR"]),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  commissionable: z.boolean().default(false),
});

workOrdersRouter.post("/work-orders/:id/items", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite lançar itens na O.S." } });
  }

  const workOrder = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!workOrder) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Ordem de serviço não encontrada." } });
  }
  if (workOrder.status === "DELIVERED" || workOrder.status === "CANCELLED") {
    return res.status(409).json({ success: false, data: null, error: { code: "WORK_ORDER_CLOSED", message: "Não é possível lançar itens em uma O.S. finalizada ou cancelada." } });
  }

  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  if (input.productId && !(await prisma.product.count({ where: { id: input.productId, tenantId } }))) {
    return res.status(404).json({ success: false, data: null, error: { code: "PRODUCT_NOT_FOUND", message: "Produto não encontrado neste tenant." } });
  }

  const item = await prisma.workOrderItem.create({
    data: {
      tenantId,
      workOrderId: workOrder.id,
      productId: input.productId ?? null,
      description: input.description,
      itemType: input.itemType,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      commissionable: input.commissionable,
    },
  });

  return res.status(201).json({ success: true, data: item, error: null });
});

workOrdersRouter.delete("/work-orders/:id/items/:itemId", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite remover itens da O.S." } });
  }

  const item = await prisma.workOrderItem.findFirst({ where: { id: req.params.itemId, tenantId, workOrderId: req.params.id } });
  if (!item) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Item não encontrado nesta ordem de serviço." } });
  }

  await prisma.workOrderItem.delete({ where: { id: item.id } });
  return res.json({ success: true, data: { id: item.id }, error: null });
});

const setBudgetSchema = z.object({
  validForDays: z.number().int().positive().max(90).default(7),
  warrantyDays: z.number().int().nonnegative().nullable().optional(),
  warrantyExclusions: z.string().nullable().optional(),
});

/**
 * Fecha o orçamento com base nos itens já lançados e gera o token de uso único
 * (Capítulo 6.4) que será embutido no link enviado por WhatsApp ao cliente.
 * Transição: qualquer estado não-terminal → AWAITING_APPROVAL.
 */
workOrdersRouter.post("/work-orders/:id/budget", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite orçar ordens de serviço." } });
  }

  const workOrder = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId }, include: { items: true } });
  if (!workOrder) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Ordem de serviço não encontrada." } });
  }
  if (workOrder.status === "DELIVERED" || workOrder.status === "CANCELLED") {
    return res.status(409).json({ success: false, data: null, error: { code: "WORK_ORDER_CLOSED", message: "Não é possível orçar uma O.S. finalizada ou cancelada." } });
  }
  if (workOrder.items.length === 0) {
    return res.status(409).json({ success: false, data: null, error: { code: "NO_ITEMS", message: "Lance ao menos uma peça ou mão de obra antes de orçar." } });
  }

  const parsed = setBudgetSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const budgetApprovalToken = randomBytes(32).toString("hex");
  const budgetValidUntil = new Date(Date.now() + input.validForDays * 24 * 60 * 60 * 1000);

  const updated = await prisma.workOrder.update({
    where: { id: workOrder.id },
    data: {
      status: "AWAITING_APPROVAL",
      budgetApprovalToken,
      budgetValidUntil,
      ...(input.warrantyDays !== undefined ? { warrantyDays: input.warrantyDays } : {}),
      ...(input.warrantyExclusions !== undefined ? { warrantyExclusions: input.warrantyExclusions } : {}),
    },
  });

  return res.json({ success: true, data: updated, error: null });
});

/**
 * ROTA PÚBLICA (sem requireAuth) — é o endpoint que o link de WhatsApp enviado
 * ao cliente efetivamente chama. A segurança aqui é inteiramente o token de
 * uso único de 256 bits (Capítulo 6.4), não uma sessão de usuário: o cliente
 * final nunca tem conta no sistema.
 */
workOrdersRouter.post("/work-orders/budget-approval/:token", async (req: Request, res: Response) => {
  try {
    // `prismaUnscoped`: esta rota é pública (sem sessão de tenant), então o client
    // tenant-scoped (`prisma`) lançaria por falta de AsyncLocalStorage — ver
    // comentário de auditoria em `approve-budget.service.ts`.
    const workOrder = await approveBudget(prismaUnscoped, req.params.token);
    return res.json({ success: true, data: workOrder, error: null });
  } catch (error) {
    if (error instanceof BudgetExpiredError) {
      return res.status(410).json({ success: false, data: null, error: { code: "BUDGET_EXPIRED", message: error.message } });
    }
    if (error instanceof BudgetAlreadyProcessedError) {
      return res.status(409).json({ success: false, data: null, error: { code: "BUDGET_ALREADY_PROCESSED", message: error.message } });
    }
    throw error;
  }
});

// CORREÇÃO DE AUDITORIA (fa-workorder-checklist-no-schema): `items` era
// `z.record(z.any())` — qualquer objeto, inclusive `{}` vazio, era aceito como
// checklist "preenchido". Cada etapa (ENTRY/DIAGNOSIS/DELIVERY) agora tem seu
// próprio schema com campos obrigatórios, refletindo o que de fato precisa ser
// conferido naquela etapa do ciclo de vida da O.S. (Capítulo 4.2). A etapa
// DELIVERY também exige `clientSignatureUrl` — é o checklist assinado pelo
// cliente na retirada, confirmando o laudo/teste final; sem assinatura, não há
// prova de aceite para liberar a entrega/faturamento (ver billAndDeliverWorkOrder).
const entryChecklistItemsSchema = z.object({
  physicalConditionNotes: z.string().trim().min(3, "Descreva o estado físico do equipamento recebido."),
  accessoriesReceived: z.string().trim().min(1, "Liste os acessórios recebidos junto com o equipamento (ou 'nenhum')."),
  hasVisibleDamage: z.boolean(),
  powersOn: z.boolean(),
});
const diagnosisChecklistItemsSchema = z.object({
  problemConfirmed: z.boolean(),
  diagnosisNotes: z.string().trim().min(3, "Descreva o diagnóstico técnico encontrado."),
  repairNeeded: z.boolean(),
});
const deliveryChecklistItemsSchema = z.object({
  functionalTestPassed: z.boolean(),
  accessoriesReturned: z.boolean(),
  clientBriefedOnWarranty: z.boolean(),
});

const checklistStageItemsSchemaByStage = {
  ENTRY: entryChecklistItemsSchema,
  DIAGNOSIS: diagnosisChecklistItemsSchema,
  DELIVERY: deliveryChecklistItemsSchema,
} as const;

const addChecklistSchema = z
  .object({
    stage: z.enum(["ENTRY", "DIAGNOSIS", "DELIVERY"]),
    items: z.record(z.any()),
    clientSignatureUrl: z.string().url().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const stageSchema = checklistStageItemsSchemaByStage[data.stage];
    const result = stageSchema.safeParse(data.items);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue, path: ["items", ...issue.path] });
      }
    }
    // Checklist de entrega é o que materializa o aceite do cliente na retirada —
    // sem assinatura, não há registro de que o cliente conferiu o equipamento.
    if (data.stage === "DELIVERY" && !data.clientSignatureUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Checklist de entrega exige a assinatura do cliente (clientSignatureUrl).",
        path: ["clientSignatureUrl"],
      });
    }
  });

workOrdersRouter.post("/work-orders/:id/checklist", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite registrar checklist." } });
  }

  const workOrder = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!workOrder) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Ordem de serviço não encontrada." } });
  }

  const parsed = addChecklistSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const checklist = await prisma.osChecklist.create({
    data: {
      tenantId,
      workOrderId: workOrder.id,
      stage: input.stage,
      items: input.items,
      clientSignatureUrl: input.clientSignatureUrl ?? null,
    },
  });

  return res.status(201).json({ success: true, data: checklist, error: null });
});

const addPhotoSchema = z.object({
  storageKey: z.string().min(1),
  caption: z.string().nullable().optional(),
});

/**
 * Registra o metadado da foto (upload binário em si já feito direto para o
 * Cloudflare R2 pelo frontend via URL assinada, Capítulo 3 — esta rota só
 * grava o ponteiro `storageKey` retornado por aquele upload).
 */
workOrdersRouter.post("/work-orders/:id/photos", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite anexar fotos." } });
  }

  const workOrder = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!workOrder) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Ordem de serviço não encontrada." } });
  }

  const parsed = addPhotoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;
  // CORREÇÃO DE AUDITORIA: `storageKey` vinha do body sem validar o prefixo
  // `tenants/<tenantId>/` — um tenant podia gravar o ponteiro de um arquivo de
  // outro tenant e, ao gerar uma URL assinada de leitura futura, acessar a foto alheia.
  if (!isTenantStorageKey(input.storageKey, tenantId)) {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_STORAGE_KEY", message: "A chave de armazenamento deve pertencer ao tenant autenticado (tenants/<tenantId>/...)." } });
  }

  const photo = await prisma.osPhoto.create({
    data: {
      tenantId,
      workOrderId: workOrder.id,
      uploadedById: userId,
      storageKey: input.storageKey,
      caption: input.caption ?? null,
    },
  });

  return res.status(201).json({ success: true, data: photo, error: null });
});

const deliverWorkOrderSchema = z.object({
  cashRegisterId: z.string().min(1),
  paymentMethod: z.enum(["CASH", "DEBIT_CARD", "CREDIT_CARD", "PIX", "BOLETO", "STORE_CREDIT"]),
});

/**
 * Entrega do equipamento: única transição válida é READY → DELIVERED.
 * CORREÇÃO DE AUDITORIA (Capítulo 4.2): "DELIVERED (pagamento + nota + termo de
 * garantia entregue)" — a entrega agora cobra o cliente de verdade (cria Sale +
 * Payment) e emite o(s) documento(s) fiscal(is) reais (NFCE para peças, NFSE
 * para mão de obra), em vez de apenas marcar o status. Ver
 * bill-and-deliver-work-order.service.ts. `deliveredAt` continua sendo a base da
 * contagem de garantia, inalterado.
 */
workOrdersRouter.post("/work-orders/:id/deliver", requireAuth, requireModule("WORK_ORDER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite entregar ordens de serviço." } });
  }
  const parsed = deliverWorkOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const result = await billAndDeliverWorkOrder(prisma, {
      tenantId,
      workOrderId: req.params.id,
      cashierId: userId,
      cashRegisterId: parsed.data.cashRegisterId,
      paymentMethod: parsed.data.paymentMethod,
    });

    // Fora da transação (commit já confirmado) — mesmo princípio de
    // close-sale.service.ts/comanda.routes.ts: nunca emitir de forma síncrona
    // dentro da transação de banco, para não segurar o lock de estoque esperando
    // resposta de rede externa (SEFAZ/Focus NFe).
    if (result.fiscalDocument) {
      await enqueueFiscalEmission({ fiscalDocumentId: result.fiscalDocument.id, tenantId });
    }
    if (result.serviceFiscalDocument) {
      await enqueueFiscalEmission({ fiscalDocumentId: result.serviceFiscalDocument.id, tenantId });
    }

    return res.json({ success: true, data: result, error: null });
  } catch (err) {
    if (err instanceof WorkOrderNotFoundError) {
      return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: err.message } });
    }
    if (err instanceof WorkOrderNotReadyForDeliveryError) {
      return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS_TRANSITION", message: err.message } });
    }
    if (err instanceof WorkOrderHasNoBillableItemsError) {
      return res.status(409).json({ success: false, data: null, error: { code: "NO_BILLABLE_ITEMS", message: err.message } });
    }
    if (err instanceof WorkOrderChecklistIncompleteError) {
      return res.status(409).json({ success: false, data: null, error: { code: "CHECKLIST_INCOMPLETE", message: err.message } });
    }
    throw err;
  }
});
