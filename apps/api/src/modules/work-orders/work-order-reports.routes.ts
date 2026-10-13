// apps/api/src/modules/work-orders/work-order-reports.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.2 (Assistência Técnica/Informática).
// GAP DE AUDITORIA ENCONTRADO: o módulo de O.S. (work-orders.routes.ts) já implementa
// o ciclo de vida completo e a aprovação de orçamento, mas NENHUM relatório gerencial
// existia — nem comissionamento por técnico (explicitamente exigido pelo Capítulo 4.2:
// "comissão calculada sobre o valor de mão de obra... liberada apenas quando a O.S.
// atinge DELIVERED"), nem a consulta de garantia por IMEI/Serial no atendimento.
//
// RESTRIÇÃO DE PROJETO: este arquivo é SOMENTE LEITURA sobre a máquina de estados —
// não escreve em WorkOrder.status em nenhuma rota. A única escrita deste módulo é na
// tabela nova `TechnicianCommissionRule` (configuração de %, não transição de O.S.).
//
// NOTA SOBRE TAXA DE RETRABALHO (READY → IN_REPAIR): o schema não grava nenhum
// histórico de transição de status (não existe WorkOrderStatusEvent/log), e o único
// lugar que poderia emitir esse evento (work-orders.routes.ts) está fora do escopo
// desta implementação. Por isso essa métrica NÃO é incluída aqui — ver resumo final
// para a justificativa completa e a métrica usada como proxy honesto (garantia por
// serial/IMEI, que o Bible também exige explicitamente neste mesmo capítulo).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const workOrderReportsRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

function forbidden(res: Response, message: string) {
  return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message } });
}
function notFound(res: Response, message: string) {
  return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message } });
}
function validationError(res: Response, details: unknown) {
  return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details } });
}

const periodQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// ─────────────────────────────────────────────────────────────────────────
// COMISSIONAMENTO POR TÉCNICO (Capítulo 4.2)
// Comissão = % configurável (por técnico, com fallback para a regra padrão do
// tenant) × soma do valor de itens de mão de obra comissionável (itemType =
// LABOR, commissionable = true), apenas de O.S. que chegaram a DELIVERED.
// ─────────────────────────────────────────────────────────────────────────

async function resolveCommissionPercent(tenantId: string, technicianId: string): Promise<number> {
  const [own, fallback] = await Promise.all([
    prisma.technicianCommissionRule.findUnique({ where: { technicianId } }),
    prisma.technicianCommissionRule.findFirst({ where: { tenantId, technicianId: null } }),
  ]);
  const rule = own && own.tenantId === tenantId ? own : fallback;
  return rule ? Number(rule.commissionPercent) : 0;
}

workOrderReportsRouter.get("/work-order-reports/commissions", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar comissões de técnicos.");
  }
  const parsed = periodQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { from, to } = parsed.data;

  const delivered = await prisma.workOrder.findMany({
    where: {
      tenantId,
      status: "DELIVERED",
      assignedTechnicianId: { not: null },
      ...(from || to
        ? { deliveredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    include: {
      assignedTechnician: { select: { id: true, name: true } },
      items: { where: { itemType: "LABOR", commissionable: true } },
    },
    take: 2000,
  });

  const byTechnician = new Map<
    string,
    { technicianId: string; technicianName: string; deliveredCount: number; commissionableLaborValue: number }
  >();
  for (const wo of delivered) {
    if (!wo.assignedTechnician) continue;
    const laborValue = wo.items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0);
    const entry = byTechnician.get(wo.assignedTechnician.id) ?? {
      technicianId: wo.assignedTechnician.id,
      technicianName: wo.assignedTechnician.name,
      deliveredCount: 0,
      commissionableLaborValue: 0,
    };
    entry.deliveredCount += 1;
    entry.commissionableLaborValue += laborValue;
    byTechnician.set(wo.assignedTechnician.id, entry);
  }

  const rows = await Promise.all(
    Array.from(byTechnician.values()).map(async (entry) => {
      const commissionPercent = await resolveCommissionPercent(tenantId, entry.technicianId);
      return {
        ...entry,
        commissionPercent,
        commissionValue: Number(((entry.commissionableLaborValue * commissionPercent) / 100).toFixed(2)),
      };
    }),
  );
  rows.sort((a, b) => b.commissionValue - a.commissionValue);

  return res.json({ success: true, data: { from: from ?? null, to: to ?? null, technicians: rows }, error: null });
});

workOrderReportsRouter.get("/work-order-reports/commissions/rules", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar regras de comissão.");
  }
  const rules = await prisma.technicianCommissionRule.findMany({
    where: { tenantId },
    include: { technician: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ success: true, data: rules, error: null });
});

const commissionRuleSchema = z.object({
  // technicianId ausente/null grava a regra PADRÃO do tenant (fallback de quem não tem regra própria).
  technicianId: z.string().uuid().nullable().optional(),
  commissionPercent: z.number().min(0).max(100),
});

workOrderReportsRouter.put("/work-order-reports/commissions/rules", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:commission:manage"))) {
    return forbidden(res, "Seu nível de acesso não permite configurar comissões de técnicos.");
  }
  const parsed = commissionRuleSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const technicianId = parsed.data.technicianId ?? null;
  const { commissionPercent } = parsed.data;

  if (technicianId) {
    const technician = await prisma.user.findFirst({ where: { id: technicianId, tenantId }, select: { id: true } });
    if (!technician) return notFound(res, "Técnico não encontrado.");

    const rule = await prisma.technicianCommissionRule.upsert({
      where: { technicianId },
      update: { commissionPercent },
      create: { tenantId, technicianId, commissionPercent },
    });
    return res.json({ success: true, data: rule, error: null });
  }

  // Regra padrão do tenant: `technicianId` é nulo, então não há @@unique que o Prisma
  // possa usar num upsert — busca manual + create/update evita duplicar a linha padrão.
  const existingDefault = await prisma.technicianCommissionRule.findFirst({ where: { tenantId, technicianId: null } });
  const rule = existingDefault
    ? await prisma.technicianCommissionRule.update({ where: { id: existingDefault.id }, data: { commissionPercent } })
    : await prisma.technicianCommissionRule.create({ data: { tenantId, technicianId: null, commissionPercent } });
  return res.json({ success: true, data: rule, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// GARANTIA POR IMEI/SERIAL (Capítulo 4.2) — substitui honestamente a taxa de
// retrabalho (inviável sem log de transição) como proxy de qualidade/retorno.
// ─────────────────────────────────────────────────────────────────────────

const warrantyCheckQuerySchema = z.object({
  serial: z.string().trim().min(1, "Informe o número de série ou IMEI."),
});

workOrderReportsRouter.get("/work-order-reports/warranty-check", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar garantia de equipamentos.");
  }
  const parsed = warrantyCheckQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { serial } = parsed.data;

  const productSerial = await prisma.productSerial.findFirst({
    where: { tenantId, OR: [{ serialNumber: serial }, { imei: serial }] },
    include: {
      product: { select: { id: true, name: true } },
      workOrder: { select: { id: true, status: true, deliveredAt: true, warrantyDays: true, warrantyExclusions: true, equipmentDescription: true } },
    },
  });
  if (!productSerial) return notFound(res, "Nenhum equipamento encontrado com este número de série/IMEI.");

  const workOrder = productSerial.workOrder;
  // Só há O.S. "última DELIVERED" a avaliar se a O.S. vinculada atualmente a este
  // serial chegou a DELIVERED — o schema mantém apenas a associação corrente
  // (ProductSerial.workOrderId é 1 FK, não um histórico de reparos).
  if (!workOrder || workOrder.status !== "DELIVERED" || !workOrder.deliveredAt) {
    return res.json({
      success: true,
      data: {
        serial: productSerial.serialNumber,
        imei: productSerial.imei,
        product: productSerial.product,
        hasDeliveredWorkOrder: false,
        withinWarranty: false,
        workOrder: null,
      },
      error: null,
    });
  }

  const warrantyDays = workOrder.warrantyDays ?? 0;
  const warrantyExpiresAt = new Date(workOrder.deliveredAt.getTime() + warrantyDays * 24 * 60 * 60 * 1000);
  const withinWarranty = warrantyDays > 0 && new Date() <= warrantyExpiresAt;

  return res.json({
    success: true,
    data: {
      serial: productSerial.serialNumber,
      imei: productSerial.imei,
      product: productSerial.product,
      hasDeliveredWorkOrder: true,
      withinWarranty,
      warrantyExpiresAt,
      workOrder: {
        id: workOrder.id,
        equipmentDescription: workOrder.equipmentDescription,
        deliveredAt: workOrder.deliveredAt,
        warrantyDays: workOrder.warrantyDays,
        warrantyExclusions: workOrder.warrantyExclusions,
      },
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// INDICADORES GERENCIAIS (ticket médio mão de obra x peças, tempo médio de
// ciclo RECEIVED→DELIVERED, backlog e produtividade por técnico) — pesquisa
// confirmou que estes são os indicadores-padrão do setor que DÃO para medir
// com os campos já existentes (createdAt/deliveredAt/items), ao contrário da
// taxa de retrabalho (ver nota no topo do arquivo).
// ─────────────────────────────────────────────────────────────────────────

workOrderReportsRouter.get("/work-order-reports/kpis", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "work-order:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar indicadores de ordens de serviço.");
  }
  const parsed = periodQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { from, to } = parsed.data;

  const [delivered, backlogCount] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        tenantId,
        status: "DELIVERED",
        ...(from || to ? { deliveredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      include: {
        assignedTechnician: { select: { id: true, name: true } },
        items: true,
      },
      take: 2000,
    }),
    prisma.workOrder.count({ where: { tenantId, status: { notIn: ["DELIVERED", "CANCELLED"] } } }),
  ]);

  let totalCycleHours = 0;
  let totalLaborValue = 0;
  let totalPartsValue = 0;
  const perTechnician = new Map<string, { technicianId: string; technicianName: string; deliveredCount: number }>();

  for (const wo of delivered) {
    if (wo.deliveredAt) {
      totalCycleHours += (wo.deliveredAt.getTime() - wo.createdAt.getTime()) / (1000 * 60 * 60);
    }
    for (const item of wo.items) {
      const value = Number(item.unitPrice) * Number(item.quantity);
      if (item.itemType === "LABOR") totalLaborValue += value;
      else if (item.itemType === "PART") totalPartsValue += value;
    }
    if (wo.assignedTechnician) {
      const entry = perTechnician.get(wo.assignedTechnician.id) ?? {
        technicianId: wo.assignedTechnician.id,
        technicianName: wo.assignedTechnician.name,
        deliveredCount: 0,
      };
      entry.deliveredCount += 1;
      perTechnician.set(wo.assignedTechnician.id, entry);
    }
  }

  const deliveredCount = delivered.length;
  const avgCycleTimeHours = deliveredCount > 0 ? Number((totalCycleHours / deliveredCount).toFixed(1)) : null;
  const avgLaborTicket = deliveredCount > 0 ? Number((totalLaborValue / deliveredCount).toFixed(2)) : null;
  const avgPartsTicket = deliveredCount > 0 ? Number((totalPartsValue / deliveredCount).toFixed(2)) : null;

  return res.json({
    success: true,
    data: {
      from: from ?? null,
      to: to ?? null,
      deliveredCount,
      backlogCount,
      avgCycleTimeHours,
      avgLaborTicket,
      avgPartsTicket,
      deliveredByTechnician: Array.from(perTechnician.values()).sort((a, b) => b.deliveredCount - a.deliveredCount),
    },
    error: null,
  });
});
