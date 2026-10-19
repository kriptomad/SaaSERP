// apps/api/src/modules/personalization/personalization.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.5 (Papelaria/Presentes) —
// "Personalização": itens personalizados (nome bordado, sublimação) são registrados
// como uma WorkOrderItem de personalização vinculada à venda, com prazo de produção e
// aprovação de arte pelo cliente antes da confecção — reaproveitando o mesmo ciclo de
// O.S. já usado na Assistência Técnica (Capítulo 4.2).
//
// RESTRIÇÃO DE PROJETO: `apps/api/src/modules/work-orders/work-orders.routes.ts` é
// arquivo restrito nesta rodada (outro agente/orquestrador mexe nele) — este módulo
// opera DIRETAMENTE sobre os models `WorkOrder`/`WorkOrderItem` via Prisma, sem jamais
// importar/chamar nada de `work-orders.routes.ts`, seguindo o mesmo padrão já usado em
// `work-order-reports.routes.ts` (router novo que lê/escreve WorkOrder sem tocar no
// arquivo restrito).
//
// MÁQUINA DE ESTADOS PRÓPRIA (não copiada do arquivo restrito): aceita apenas avanço
// simples na ordem RECEIVED < IN_REPAIR < READY < DELIVERED. Mais simples que a tabela
// ALLOWED_STATUS_TRANSITIONS do módulo de Assistência Técnica (que trata diagnóstico/
// orçamento/cancelamento) porque o ciclo de personalização não tem diagnóstico nem
// aprovação de orçamento — só aprovação de arte (rota própria abaixo).
//
// Permissão nova (documentar para o orquestrador seedar em packages/db/prisma/seed.ts):
//   "personalization:order:read"  — consultar O.S. de personalização
//   "personalization:order:write" — criar/editar O.S. de personalização, aprovar arte, mudar status
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";

export const personalizationRouter = Router();

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

// ─────────────────────────────────────────────────────────────────────────
// CRIAÇÃO DE O.S. DE PERSONALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────

const createOrderSchema = z.object({
  saleItemId: z.string().uuid(),
  clientId: z.string().uuid(),
  description: z.string().trim().min(1),
  productionDueAt: z.coerce.date(),
});

personalizationRouter.post("/personalization-orders", requireAuth, requireModule("GIFT_PERSONALIZATION"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "personalization:order:write"))) {
    return forbidden(res, "Seu nível de acesso não permite criar ordens de personalização.");
  }
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const input = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: input.clientId, tenantId }, select: { id: true } });
  if (!client) return notFound(res, "Cliente não encontrado.");

  // CORREÇÃO DE AUDITORIA: a rota aceitava qualquer `clientId` informado pelo
  // client, sem checar se correspondia ao cliente REAL da venda
  // (`saleItem.sale.clientId`) — permitindo abrir uma O.S. de personalização em
  // nome de um cliente diferente de quem efetivamente comprou o item.
  const saleItem = await prisma.saleItem.findFirst({
    where: { id: input.saleItemId, sale: { tenantId } },
    include: { sale: { select: { id: true, tenantId: true, clientId: true } }, personalizationItem: { select: { id: true } } },
  });
  if (!saleItem) return notFound(res, "Item de venda não encontrado neste tenant.");
  if (saleItem.sale.clientId !== input.clientId) {
    return res.status(409).json({
      success: false,
      data: null,
      error: {
        code: "CLIENT_MISMATCH",
        message: "O clientId informado não corresponde ao cliente real desta venda.",
      },
    });
  }
  if (saleItem.personalizationItem) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "ALREADY_LINKED", message: "Este item de venda já possui uma O.S. de personalização vinculada." },
    });
  }

  const workOrder = await prisma.workOrder.create({
    data: {
      tenantId,
      clientId: client.id,
      equipmentDescription: `Personalização — ${input.description}`,
      reportedIssue: input.description,
      status: "RECEIVED",
      items: {
        create: {
          tenantId,
          description: input.description,
          itemType: "LABOR",
          quantity: 1,
          unitPrice: saleItem.totalPrice,
          commissionable: false,
          saleItemId: saleItem.id,
          productionDueAt: input.productionDueAt,
        },
      },
    },
    include: { items: true },
  });

  return res.status(201).json({ success: true, data: workOrder, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// LISTAGEM — apenas O.S. que têm ao menos um item de personalização vinculado
// ─────────────────────────────────────────────────────────────────────────

personalizationRouter.get("/personalization-orders", requireAuth, requireModule("GIFT_PERSONALIZATION"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "personalization:order:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar ordens de personalização.");
  }

  const workOrders = await prisma.workOrder.findMany({
    where: { tenantId, items: { some: { saleItemId: { not: null } } } },
    include: { items: true, client: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    // CORREÇÃO DE AUDITORIA: listagem sem nenhum teto/paginação.
    take: 200,
  });
  return res.json({ success: true, data: workOrders, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// APROVAÇÃO DE ARTE
// ─────────────────────────────────────────────────────────────────────────

personalizationRouter.patch("/personalization-orders/:workOrderItemId/approve-art", requireAuth, requireModule("GIFT_PERSONALIZATION"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "personalization:order:write"))) {
    return forbidden(res, "Seu nível de acesso não permite aprovar arte de personalização.");
  }

  // CORREÇÃO DE AUDITORIA: a rota aceitava aprovar arte de QUALQUER
  // `WorkOrderItem` do tenant (ex.: peça/mão de obra de uma O.S. de assistência
  // técnica comum), não apenas itens de personalização de fato
  // (`saleItemId` preenchido é o que identifica um item como de personalização
  // neste módulo — ver `GET /personalization-orders` acima, que usa o mesmo
  // critério).
  const item = await prisma.workOrderItem.findFirst({ where: { id: req.params.workOrderItemId, tenantId, saleItemId: { not: null } } });
  if (!item) return notFound(res, "Item de O.S. de personalização não encontrado.");

  const updated = await prisma.workOrderItem.update({ where: { id: item.id }, data: { artApprovedAt: new Date() } });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// TRANSIÇÃO DE STATUS — versão própria e simplificada (ver nota no topo do arquivo),
// aceita apenas avançar na ordem RECEIVED < IN_REPAIR < READY < DELIVERED.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_ORDER = ["RECEIVED", "IN_REPAIR", "READY", "DELIVERED"] as const;
type PersonalizationStatus = (typeof STATUS_ORDER)[number];

const statusUpdateSchema = z.object({
  status: z.enum(STATUS_ORDER),
});

personalizationRouter.patch("/personalization-orders/:workOrderId/status", requireAuth, requireModule("GIFT_PERSONALIZATION"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "personalization:order:write"))) {
    return forbidden(res, "Seu nível de acesso não permite alterar o status desta ordem de personalização.");
  }
  const parsed = statusUpdateSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: req.params.workOrderId, tenantId, items: { some: { saleItemId: { not: null } } } },
    include: { items: { where: { saleItemId: { not: null } }, select: { id: true, artApprovedAt: true } } },
  });
  if (!workOrder) return notFound(res, "Ordem de personalização não encontrada.");

  const currentIndex = STATUS_ORDER.indexOf(workOrder.status as PersonalizationStatus);
  const nextIndex = STATUS_ORDER.indexOf(parsed.data.status);
  if (currentIndex === -1 || nextIndex <= currentIndex) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "INVALID_TRANSITION", message: `Não é possível voltar ou repetir o status (atual: ${workOrder.status}).` },
    });
  }

  // CORREÇÃO DE AUDITORIA: o status avançava para produção/conclusão
  // (IN_REPAIR em diante) mesmo sem nenhuma aprovação de arte registrada —
  // permitindo a confecção começar sobre uma arte que o cliente nunca validou.
  // Avançar além de RECEIVED (ou seja, entrar em produção) exige que TODOS os
  // itens de personalização desta O.S. já tenham `artApprovedAt` preenchido.
  const entersProduction = nextIndex > STATUS_ORDER.indexOf("RECEIVED");
  if (entersProduction && workOrder.items.some((item) => !item.artApprovedAt)) {
    return res.status(409).json({
      success: false,
      data: null,
      error: {
        code: "ART_NOT_APPROVED",
        message: "Todos os itens de personalização desta O.S. precisam ter a arte aprovada pelo cliente antes de avançar para produção/conclusão.",
      },
    });
  }

  const updated = await prisma.workOrder.update({
    where: { id: workOrder.id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
    },
  });
  return res.json({ success: true, data: updated, error: null });
});
