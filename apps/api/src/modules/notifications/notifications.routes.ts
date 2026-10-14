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

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        tenantId,
        OR: [{ userId }, { userId: null }],
        ...(onlyUnread ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({
      where: { tenantId, OR: [{ userId }, { userId: null }], readAt: null },
    }),
  ]);

  return res.json({ success: true, data: { notifications, unreadCount }, error: null });
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
