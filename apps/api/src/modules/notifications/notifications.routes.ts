// apps/api/src/modules/notifications/notifications.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.4 — Sistema Central de Notificações.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: notifyTenant() (ponto único de entrada
// para todo o sistema gravar notificações) existia desde o início, mas nenhuma rota
// REST jamais permitiu ao frontend listar/ler essas notificações — o "sininho" de
// notificações descrito no Capítulo 8.4 não tinha de onde consumir dados reais.
import { Router, Request, Response } from "express";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const notificationsRouter = Router();

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
