// apps/api/src/modules/platform-admin/database-backups.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 10.3 — Backup Criptografado sem Downtime.
// Rotas do painel admin para visualizar o histórico de backups (`DatabaseBackupLog`)
// e disparar um backup manual fora do cron diário 03:00 (ex.: antes de uma migração
// arriscada em produção). Mesmo padrão de RBAC/audit-log de `platform-secrets.routes.ts`.
import { Router, Request, Response } from "express";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requirePlatformAdminAuth, requireSuperAdmin } from "./platform-admin-auth.middleware";
import { databaseBackupQueue } from "../../lib/queue";
import { presignPlatformObjectDownload } from "../../lib/object-storage";

export const databaseBackupsRouter = Router();

async function writeAuditLog(req: Request, action: string, targetId: string | null, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
      action,
      targetType: "DatabaseBackupLog",
      targetId,
      metadata: metadata as any,
    },
  });
}

// GET /platform-admin/database-backups — histórico (mais recentes primeiro), nunca
// devolve o `storageKey` cru (download sempre via URL assinada de curta duração).
databaseBackupsRouter.get("/platform-admin/database-backups", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const logs = await prisma.databaseBackupLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return res.json({
    success: true,
    data: logs.map((l) => ({
      id: l.id,
      startedAt: l.startedAt,
      finishedAt: l.finishedAt,
      status: l.status,
      hasFile: Boolean(l.storageKey),
      fileSizeBytes: l.fileSizeBytes ? l.fileSizeBytes.toString() : null,
      errorMessage: l.errorMessage,
      triggeredBy: l.triggeredBy,
      encryptionKeyId: l.encryptionKeyId,
    })),
    error: null,
  });
});

// POST /platform-admin/database-backups/trigger — enfileira um backup sob demanda.
// Restrito a SUPER_ADMIN: dispara um dump completo da plataforma (custo de CPU/IO
// real no banco de produção).
databaseBackupsRouter.post(
  "/platform-admin/database-backups/trigger",
  requirePlatformAdminAuth,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const platformAdminUserId = req.platformAdminSession!.platformAdminUserId;
    await databaseBackupQueue.add("manual-backup", { triggeredBy: platformAdminUserId });
    await writeAuditLog(req, "database_backup.trigger_manual", null, {});
    return res.json({ success: true, data: { queued: true }, error: null });
  },
);

// GET /platform-admin/database-backups/:id/download — URL assinada de curta duração
// para baixar o arquivo .enc (o painel nunca decifra — a chave nunca sai do servidor
// via rede; decifrar é responsabilidade do `scripts/restore-encrypted-backup.mjs`
// rodado por um operador com acesso direto a BACKUP_ENCRYPTION_KEY).
databaseBackupsRouter.get(
  "/platform-admin/database-backups/:id/download",
  requirePlatformAdminAuth,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const log = await prisma.databaseBackupLog.findUnique({ where: { id: req.params.id } });
    if (!log || !log.storageKey) {
      return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Backup não encontrado ou sem arquivo associado." } });
    }
    const { downloadUrl, expiresInSeconds } = await presignPlatformObjectDownload(log.storageKey);
    await writeAuditLog(req, "database_backup.download", log.id, {});
    return res.json({ success: true, data: { downloadUrl, expiresInSeconds }, error: null });
  },
);
