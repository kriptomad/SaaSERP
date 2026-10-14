// apps/api/src/modules/optical/optical-lab-work-orders.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.2 — Ótica: pedido de laboratório óptico
// (prazo de entrega: estoque 1-2 dias úteis, personalizada 3-10+ dias úteis) aberto
// automaticamente no fechamento da venda de lente de grau (close-sale.service.ts),
// com notificação ao cliente quando o status muda para READY.
//
// RESTRIÇÃO DE PROJETO: `work-orders.routes.ts` está sob restrição de edição de
// outra correção (SOMENTE LEITURA aqui) — por isso a transição de status de O.S. de
// laboratório óptico (que precisa do gancho de notificação deste nicho) vive neste
// router companheiro dedicado, mesmo padrão já usado em `work-order-reports.routes.ts`
// (Rodada 5) para não tocar no arquivo restrito. Opera sobre o mesmo model `WorkOrder`
// do Prisma, filtrado por `workOrderType = OPTICAL_LAB` — nunca mexe em O.S. de
// reparo geral (`GENERAL_REPAIR`), que continua 100% sob o fluxo do arquivo restrito.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { notifyTenant } from "../notifications/notify.service";

export const opticalLabWorkOrdersRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

async function requireRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "optical:lab:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar pedidos de laboratório óptico." } });
    return false;
  }
  return true;
}
async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "optical:lab:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite atualizar pedidos de laboratório óptico." } });
    return false;
  }
  return true;
}

opticalLabWorkOrdersRouter.get("/optical-lab-work-orders", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const status = req.query.status as string | undefined;
  const orders = await prisma.workOrder.findMany({
    where: { tenantId, workOrderType: "OPTICAL_LAB", ...(status ? { status: status as any } : {}) },
    include: { client: { select: { id: true, name: true, phone: true } }, opticalPrescription: { select: { id: true, prescriptionNumber: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: orders, error: null });
});

opticalLabWorkOrdersRouter.get("/optical-lab-work-orders/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const order = await prisma.workOrder.findFirst({
    where: { id: req.params.id, tenantId, workOrderType: "OPTICAL_LAB" },
    include: { client: { select: { id: true, name: true, phone: true } }, opticalPrescription: true },
  });
  if (!order) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pedido de laboratório óptico não encontrado." } });
  return res.json({ success: true, data: order, error: null });
});

const statusSchema = z.object({ status: z.enum(["IN_REPAIR", "READY", "DELIVERED", "CANCELLED"]) });

// Transição de status dedicada (nunca o PATCH genérico de work-orders.routes.ts,
// que está fora do escopo editável desta rodada) — dispara a notificação ao
// cliente quando o status muda para READY (Capítulo 11.2, item 2 do escopo).
opticalLabWorkOrdersRouter.patch("/optical-lab-work-orders/:id/status", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  const existing = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId, workOrderType: "OPTICAL_LAB" }, include: { client: { select: { id: true, name: true } } } });
  if (!existing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pedido de laboratório óptico não encontrado." } });

  const updated = await prisma.workOrder.update({
    where: { id: existing.id },
    data: { status: parsed.data.status, ...(parsed.data.status === "DELIVERED" ? { deliveredAt: new Date() } : {}) },
  });

  // Capítulo 11.2 — Ótica: notifica o cliente quando a lente/armação fica pronta
  // para retirada. Reaproveita o motor central de notificações (`notifyTenant`,
  // Capítulo 8.4) — o fan-out real por WhatsApp/SMS (Capítulo 20.2/20.8) permanece
  // pendente de um worker BullMQ dedicado, mesma pendência honesta já documentada
  // para toda notificação do sistema (Rodada 4, decisão #3); este endpoint garante
  // que a notificação INTERNA é criada de fato.
  if (parsed.data.status === "READY") {
    await notifyTenant({
      tenantId,
      category: "WORK_ORDER_STATUS",
      title: `Lente/armação pronta para retirada — ${existing.client.name}`,
      body: `O pedido de laboratório óptico de ${existing.client.name} está pronto para retirada.`,
      severity: "INFO",
      linkRoute: `/optica/laboratorio/${existing.id}`,
      sourceType: "WORK_ORDER",
      sourceId: existing.id,
    });
  }

  return res.json({ success: true, data: updated, error: null });
});
