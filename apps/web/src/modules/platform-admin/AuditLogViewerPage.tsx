// apps/web/src/modules/platform-admin/AuditLogViewerPage.tsx
// Capítulo 13.4 — visão global e somente-leitura do audit log append-only (toda
// ação sensível do painel, incluindo autenticação AUTH_* do Capítulo 14.4).
import { useEffect, useState } from "react";
import { Alert, Box, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { listAuditLogs, AuditLogEntry } from "./platform-admin-ops.api";

const TARGET_TYPES = ["Tenant", "FeatureFlag", "SystemParameter", "TenantApiKey", "PlatformAdminUser", "SupportTicket"];

export function AuditLogViewerPage() {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [targetType, setTargetType] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAuditLogs({ targetType: targetType || undefined }).then(setLogs).catch((err) => setError((err as Error).message));
  }, [targetType]);

  return (
    <Box sx={{ p: 3, maxWidth: 1300, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Audit log</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Registro append-only de toda ação sensível do painel — nunca editável ou apagável.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <TextField select label="Tipo de alvo" size="small" value={targetType} onChange={(e) => setTargetType(e.target.value)} sx={{ minWidth: 220, mb: 2 }}>
        <MenuItem value="">Todos</MenuItem>
        {TARGET_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
      </TextField>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Quando</TableCell>
              <TableCell>Ação</TableCell>
              <TableCell>Alvo</TableCell>
              <TableCell>Detalhes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(logs ?? []).map((log) => (
              <TableRow key={log.id}>
                <TableCell>{new Date(log.createdAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell>{log.action}</TableCell>
                <TableCell>{log.targetType}{log.targetId ? ` (${log.targetId.slice(0, 8)}…)` : ""}</TableCell>
                <TableCell><code style={{ fontSize: 11 }}>{JSON.stringify(log.metadata)}</code></TableCell>
              </TableRow>
            ))}
            {logs && logs.length === 0 && <TableRow><TableCell colSpan={4}>Nenhum evento registrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
