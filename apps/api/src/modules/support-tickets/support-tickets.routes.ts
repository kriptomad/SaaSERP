// apps/api/src/modules/support-tickets/support-tickets.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 15.3 — Helpdesk Interno Vinculado ao
// Tenant. GAP DE AUDITORIA FECHADO (`helpdesk-tenant-ui`): `SupportTicket`/
// `SupportTicketMessage` e o lado "dono do SaaS" (listar/atribuir/responder) já
// existiam em platform-admin.routes.ts, mas NENHUMA rota permitia ao lojista (o
// outro lado da conversa) abrir um chamado, ver o andamento ou responder — o
// helpdesk existia apenas para quem está do lado de dentro do painel de plataforma.
//
// Isolamento: `SupportTicket` tem `tenantId` próprio no schema (ao contrário de
// `SupportTicketMessage`, que herda isolamento via `ticketId` — ver nota de
// auditoria em prisma-tenant-extension.ts) e portanto participa normalmente da
// extensão tenant-scoped (`prisma` injeta `tenantId` da sessão automaticamente em
// toda query abaixo); `SupportTicketMessage` precisa de checagem manual de posse do
// ticket antes de cada escrita, pelo mesmo motivo que o lado platform-admin faz.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { readEnumQuery } from "../../lib/query-enum";
import { zodValidationErrorResponse } from "../../lib/validation-error";

export const supportTicketsRouter = Router();

const createTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  category: z.enum(["BILLING", "BUG", "HOW_TO", "INTEGRATION", "OUTAGE"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  body: z.string().min(1).max(10_000),
  attachmentUrls: z.array(z.string().max(2048)).max(10).default([]),
});

// POST /support-tickets — abre um chamado novo, já com a primeira mensagem (o
// próprio relato do problema) para nunca existir um ticket "vazio" sem contexto.
supportTicketsRouter.post("/support-tickets", requireAuth, async (req: Request, res: Response) => {
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return zodValidationErrorResponse(res, parsed.error);
  }
  const { tenantId, userId } = req.session!;
  const { subject, category, priority, body, attachmentUrls } = parsed.data;

  const ticket = await prisma.supportTicket.create({
    data: { tenantId, openedByUserId: userId, subject, category, priority, status: "OPEN" },
  });
  const message = await prisma.supportTicketMessage.create({
    data: { ticketId: ticket.id, authorType: "TENANT_USER", authorId: userId, body, attachmentUrls },
  });

  return res.status(201).json({ success: true, data: { ...ticket, messages: [message] }, error: null });
});

// GET /support-tickets — lista os chamados do próprio tenant (auto-isolado pela
// extensão — ver cabeçalho).
// CORREÇÃO DE AUDITORIA (fa-perf-support-tickets-no-pagination): `findMany` sem
// skip/take/select retornava TODOS os chamados do tenant por completo — mesmo
// padrão page/pageSize de users.routes.ts/stock.routes.ts, com select trimado às
// colunas usadas pela listagem (nunca o corpo das mensagens, que só vem no detalhe).
supportTicketsRouter.get("/support-tickets", requireAuth, async (req: Request, res: Response) => {
  const statusParsed = readEnumQuery(res, req.query.status, ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"] as const, "status");
  if (!statusParsed.ok) return;

  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
  const where = { ...(statusParsed.value ? { status: statusParsed.value } : {}) };

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { id: true, subject: true, category: true, priority: true, status: true, openedByUserId: true, assignedToPlatformAdminUserId: true, createdAt: true, resolvedAt: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return res.json({ success: true, meta: { page, pageSize, total }, data: tickets, error: null });
});

async function findOwnTicketOrRespond(req: Request, res: Response) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  // `prisma.supportTicket.findUnique` já é tenant-scoped pela extensão (injeta
  // `tenantId` no `where` automaticamente) — um ticket de outro tenant nunca é
  // encontrado aqui, retornando 404 em vez de vazar a existência do registro.
  if (!ticket) {
    res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chamado não encontrado." } });
    return null;
  }
  return ticket;
}

// GET /support-tickets/:id — detalhe + histórico de mensagens.
supportTicketsRouter.get("/support-tickets/:id", requireAuth, async (req: Request, res: Response) => {
  const ticket = await findOwnTicketOrRespond(req, res);
  if (!ticket) return;
  return res.json({ success: true, data: ticket, error: null });
});

const addMessageSchema = z.object({
  body: z.string().min(1).max(10_000),
  attachmentUrls: z.array(z.string().max(2048)).max(10).default([]),
});

// POST /support-tickets/:id/messages — lojista responde ao atendimento. Reabre o
// chamado automaticamente se o suporte tinha marcado "aguardando cliente" e o
// cliente acabou de responder — nunca deixa o ticket "congelado" em
// WAITING_CUSTOMER depois que o cliente já respondeu.
supportTicketsRouter.post("/support-tickets/:id/messages", requireAuth, async (req: Request, res: Response) => {
  const parsed = addMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return zodValidationErrorResponse(res, parsed.error);
  }
  const ticket = await findOwnTicketOrRespond(req, res);
  if (!ticket) return;
  const { userId } = req.session!;

  const message = await prisma.supportTicketMessage.create({
    data: { ticketId: ticket.id, authorType: "TENANT_USER", authorId: userId, body: parsed.data.body, attachmentUrls: parsed.data.attachmentUrls },
  });

  if (ticket.status === "WAITING_CUSTOMER") {
    await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "IN_PROGRESS" } });
  }

  return res.status(201).json({ success: true, data: message, error: null });
});
