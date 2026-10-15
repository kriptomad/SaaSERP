// apps/web/src/modules/platform-admin/database-backups.api.ts
// Cliente do painel admin para o histórico de backups criptografados (Capítulo 10.3).
import { platformAdminApi } from "./platform-admin-client";

export interface DatabaseBackupLog {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  hasFile: boolean;
  fileSizeBytes: string | null;
  errorMessage: string | null;
  triggeredBy: string;
  encryptionKeyId: string | null;
}

export function listDatabaseBackups(): Promise<DatabaseBackupLog[]> {
  return platformAdminApi.get<DatabaseBackupLog[]>("/platform-admin/database-backups");
}

export function triggerDatabaseBackup(): Promise<{ queued: boolean }> {
  return platformAdminApi.post<{ queued: boolean }>("/platform-admin/database-backups/trigger");
}

export function getDatabaseBackupDownloadUrl(id: string): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  return platformAdminApi.get<{ downloadUrl: string; expiresInSeconds: number }>(`/platform-admin/database-backups/${id}/download`);
}
