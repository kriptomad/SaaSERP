// apps/web/src/modules/platform-admin/AuditLogViewerPage.tsx
// Capítulo 13.4 — visão global e somente-leitura do audit log append-only (toda
// ação sensível do painel, incluindo autenticação AUTH_* do Capítulo 14.4).
import { useEffect, useState } from "react";
import { Alert, Box, Button, Grid, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { listAuditLogs, listPlatformAdminUsers, AuditLogEntry, PlatformAdminUserSummary } from "./platform-admin-ops.api";

const TARGET_TYPES = ["Tenant", "FeatureFlag", "SystemParameter", "TenantApiKey", "PlatformAdminUser", "SupportTicket"];

// CORREÇÃO DE AUDITORIA (mega-audit round de 100%, criticidade MEDIA): a tela
// só filtrava por tipo de alvo. Adicionados filtros por admin responsável,
// texto livre da ação e janela de tempo (de/até) — todos os campos já
// existiam no modelo `AuditLog`, só não eram expostos como filtro de consulta.
export function AuditLogViewerPage() {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [admins, setAdmins] = useState<PlatformAdminUserSummary[]>([]);
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [action, setAction] = useState("");
  const [platformAdminUserId, setPlatformAdminUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlatformAdminUsers().then(setAdmins).catch(() => setAdmins([]));
  }, []);

  function refresh() {
    listAuditLogs({
      targetType: targetType || undefined,
      targetId: targetId.trim() || undefined,
      action: action.trim() || undefined,
      platformAdminUserId: platformAdminUserId || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
    })
      .then(setLogs)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, platformAdminUserId]);

  function clearFilters() {
    setTargetType("");
    setTargetId("");
    setAction("");
    setPlatformAdminUserId("");
    setFrom("");
    setTo("");
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1300, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Audit log</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Registro append-only de toda ação sensível do painel — nunca editável ou apagável.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={2}>
          <TextField select fullWidth label="Tipo de alvo" size="small" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
            <MenuItem value="">Todos</MenuItem>
            {TARGET_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={12} sm={2}>
          <TextField fullWidth label="ID do alvo" size="small" value={targetId} onChange={(e) => setTargetId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && refresh()} />
        </Grid>
        <Grid item xs={12} sm={2}>
          <TextField fullWidth label="Ação (contém)" size="small" value={action} onChange={(e) => setAction(e.target.value)} onKeyDown={(e) => e.key === "Enter" && refresh()} />
        </Grid>
        <Grid item xs={12} sm={2}>
          <TextField select fullWidth label="Admin responsável" size="small" value={platformAdminUserId} onChange={(e) => setPlatformAdminUserId(e.target.value)}>
            <MenuItem value="">Todos</MenuItem>
            {admins.map((a) => <MenuItem key={a.id} value={a.id}>{a.name} ({a.email}){!a.active ? " — inativo" : ""}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={6} sm={1.5}>
          <TextField fullWidth type="datetime-local" label="De" size="small" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Grid>
        <Grid item xs={6} sm={1.5}>
          <TextField fullWidth type="datetime-local" label="Até" size="small" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
        </Grid>
        <Grid item xs={12} sm={1} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button size="small" variant="contained" onClick={refresh}>Filtrar</Button>
        </Grid>
      </Grid>
      <Button size="small" onClick={clearFilters} sx={{ mb: 1 }}>Limpar filtros</Button>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Quando</TableCell>
              <TableCell>Admin</TableCell>
              <TableCell>Ação</TableCell>
              <TableCell>Alvo</TableCell>
              <TableCell>Detalhes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(logs ?? []).map((log) => (
              <TableRow key={log.id}>
                <TableCell>{new Date(log.createdAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell>{log.platformAdminUser ? `${log.platformAdminUser.name}` : log.platformAdminUserId.slice(0, 8)}</TableCell>
                <TableCell>{log.action}</TableCell>
                <TableCell>{log.targetType}{log.targetId ? ` (${log.targetId.slice(0, 8)}…)` : ""}</TableCell>
                <TableCell><code style={{ fontSize: 11 }}>{JSON.stringify(log.metadata)}</code></TableCell>
              </TableRow>
            ))}
            {logs && logs.length === 0 && <TableRow><TableCell colSpan={5}>Nenhum evento registrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
