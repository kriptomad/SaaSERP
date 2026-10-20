// apps/api/src/modules/notifications/notifications.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.4 — Sistema Central de Notificações.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: notifyTenant() (ponto único de entrada
// para todo o sistema gravar notificações) existia desde o início, mas nenhuma rota
// REST jamais permitiu ao frontend listar/ler essas notificações — o "sininho" de
// notificações descrito no Capítulo 8.4 não tinha de onde consumir dados reais.
import { Router, Request, Response } from "express";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { registerSseClient } from "../../lib/sse";

export const notificationsRouter = Router();

/**
 * Stream SSE para o sininho de notificações ao vivo (Capítulo 8.2/8.4). Também
 * carrega eventos de categoria WORK_ORDER_STATUS, cobrindo o requisito de status
 * de O.S. ao vivo sem precisar de um segundo canal de conexão por aba.
 * `requireAuth` já garante `req.session`; a conexão fica aberta até o cliente
 * desconectar (cleanup garantido via registerSseClient).
 */
notificationsRouter.get("/notifications/stream", requireAuth, (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const cleanup = registerSseClient(tenantId, userId, res);
  req.on("close", cleanup);
});

/**
 * Lista notificações visíveis ao usuário logado: as dirigidas especificamente a ele
 * (`userId = req.session.userId`) OU as de broadcast do tenant (`userId = null`,
 * ex.: alerta de caixa visto por qualquer OWNER/MANAGER — Capítulo 8.4).
 */
notificationsRouter.get("/notifications", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const onlyUnread = req.query.unreadOnly === "true";
  // CORREÇÃO DE AUDITORIA (fa-w6-api-unbounded-lists-batch): upgrade do teto
  // simples `take:50` para paginação completa page/pageSize+meta (adiciona
  // `meta.total`, não quebra o shape `data:{notifications,unreadCount}` já
  // consumido pelo sininho em NotificationBell.tsx/notifications/api.ts).
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
  const feedWhere = {
    tenantId,
    OR: [{ userId }, { userId: null }],
    ...(onlyUnread ? { readAt: null } : {}),
  };

  const [notifications, feedTotal, ownUnreadCount, broadcastUnreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: feedWhere,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where: feedWhere }),
    // CORREÇÃO DE AUDITORIA (fa-w5-perf-notification-count-scan): o antigo
    // `count({ OR: [{userId}, {userId: null}] })` não alinha bem com o índice
    // existente `@@index([tenantId, userId, readAt])` para o ramo `userId: null`
    // (OR força o planner a considerar um bitmap/union em vez de um único scan de
    // índice direto). Duas contagens separadas — cada uma uma igualdade simples de
    // (tenantId, userId, readAt) — usam o índice composto já existente de forma
    // direta, sem precisar de um índice novo; a soma em memória é equivalente ao
    // `count(OR)` original (os dois conjuntos são disjuntos: userId = X vs. userId
    // IS NULL nunca se sobrepõem).
    prisma.notification.count({ where: { tenantId, userId, readAt: null } }),
    prisma.notification.count({ where: { tenantId, userId: null, readAt: null } }),
  ]);
  const unreadCount = ownUnreadCount + broadcastUnreadCount;

  return res.json({ success: true, data: { notifications, unreadCount }, error: null, meta: { page, pageSize, total: feedTotal } });
});

notificationsRouter.patch("/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const notification = await prisma.notification.findFirst({
    where: { id: req.params.id, tenantId, OR: [{ userId }, { userId: null }] },
  });
  if (!notification) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Notificação não encontrada." } });
  }
  const updated = await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
  return res.json({ success: true, data: updated, error: null });
});

notificationsRouter.patch("/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const result = await prisma.notification.updateMany({
    where: { tenantId, OR: [{ userId }, { userId: null }], readAt: null },
    data: { readAt: new Date() },
  });
  return res.json({ success: true, data: { updatedCount: result.count }, error: null });
});
