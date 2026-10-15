// apps/web/src/modules/platform-admin/DatabaseBackupsPage.tsx
// Capítulo 10.3 — Backup Criptografado sem Downtime: histórico (cron diário 03:00 +
// disparos manuais) e botão de "Fazer backup agora" (SUPER_ADMIN only).
import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";
import { DatabaseBackupLog, getDatabaseBackupDownloadUrl, listDatabaseBackups, triggerDatabaseBackup } from "./database-backups.api";

function formatBytes(bytes: string | null): string {
  if (!bytes) return "—";
  const value = Number(bytes);
  if (!Number.isFinite(value)) return "—";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function statusColor(status: DatabaseBackupLog["status"]): "default" | "success" | "error" | "warning" {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED") return "error";
  return "warning";
}

export function DatabaseBackupsPage() {
  const { admin } = usePlatformAdminAuth();
  const canTrigger = admin?.role === "SUPER_ADMIN";
  const [logs, setLogs] = useState<DatabaseBackupLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    listDatabaseBackups().then(setLogs).catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    reload();
    // Atualiza a cada 15s — útil para acompanhar um backup manual recém-disparado
    // (status RUNNING → SUCCESS/FAILED) sem exigir F5.
    const interval = setInterval(reload, 15_000);
    return () => clearInterval(interval);
  }, [reload]);

  async function handleTrigger() {
    setTriggering(true);
    setError(null);
    try {
      await triggerDatabaseBackup();
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTriggering(false);
    }
  }

  async function handleDownload(id: string) {
    setDownloadingId(id);
    setError(null);
    try {
      const { downloadUrl } = await getDatabaseBackupDownloadUrl(id);
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="h5">Backups do banco de dados</Typography>
        {canTrigger && (
          <Button variant="contained" onClick={handleTrigger} disabled={triggering} startIcon={triggering ? <CircularProgress size={16} /> : undefined}>
            Fazer backup agora
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Dump lógico completo da plataforma (todos os tenants), comprimido e cifrado em AES-256-GCM antes de subir ao Cloudflare R2.
        Executa automaticamente todo dia às 03:00. O download devolve o arquivo <code>.enc</code> cru — a decifração/restauração é feita
        com <code>apps/api/scripts/restore-encrypted-backup.mjs</code>, usando a chave BACKUP_ENCRYPTION_KEY configurada em Infraestrutura.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Início</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Origem</TableCell>
              <TableCell>Tamanho</TableCell>
              <TableCell>Erro</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(logs ?? []).map((log) => (
              <TableRow key={log.id}>
                <TableCell>{new Date(log.startedAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell><Chip size="small" color={statusColor(log.status)} label={log.status} /></TableCell>
                <TableCell>{log.triggeredBy === "cron" ? "Automático (03:00)" : "Manual"}</TableCell>
                <TableCell>{formatBytes(log.fileSizeBytes)}</TableCell>
                <TableCell>
                  {log.errorMessage ? (
                    <Tooltip title={log.errorMessage}>
                      <Typography variant="body2" color="error" sx={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {log.errorMessage}
                      </Typography>
                    </Tooltip>
                  ) : "—"}
                </TableCell>
                <TableCell align="right">
                  {log.hasFile && canTrigger && (
                    <Button size="small" disabled={downloadingId === log.id} onClick={() => handleDownload(log.id)}>
                      Baixar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {logs && logs.length === 0 && <TableRow><TableCell colSpan={6}>Nenhum backup registrado ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
