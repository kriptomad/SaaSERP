// apps/web/src/modules/platform-admin/TenantDetailPage.tsx
// Capítulo 13.2/13.1 — detalhe de um tenant: dados cadastrais, troca de status
// (suspender/reativar/forçar trial) e início de sessão de impersonation (abre uma
// nova aba já logada como o OWNER do tenant, via o mesmo mecanismo `?sso=` usado
// pelo shell desktop — nenhum código de SSO duplicado).
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";
import { getTenant, TenantSummary, updateTenantStatus, startImpersonation, listImpersonationSessions, ImpersonationSessionRecord, listAuditLogs, AuditLogEntry } from "./platform-admin-ops.api";

// Mesmo esquema de codificação consumido por `consumeSsoFromQuery` em
// apps/web/src/api/client.ts (base64url de um JSON UTF-8).
function base64UrlEncode(json: string): string {
  const base64 = btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function StatusDialog({ tenant, onClose, onSaved }: { tenant: TenantSummary; onClose: () => void; onSaved: (t: TenantSummary) => void }) {
  const [status, setStatus] = useState<TenantSummary["status"]>(tenant.status);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTenantStatus(tenant.id, { status, reason });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Alterar status do tenant</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField select fullWidth label="Novo status" size="small" value={status} onChange={(e) => setStatus(e.target.value as TenantSummary["status"])} sx={{ mb: 2, mt: 1 }}>
          <MenuItem value="TRIAL">Trial</MenuItem>
          <MenuItem value="ACTIVE">Ativo</MenuItem>
          <MenuItem value="PAST_DUE">Inadimplente</MenuItem>
          <MenuItem value="SUSPENDED">Suspenso</MenuItem>
          <MenuItem value="CANCELLED">Cancelado</MenuItem>
        </TextField>
        <TextField fullWidth multiline minRows={2} label="Justificativa (obrigatória, auditada)" size="small" value={reason} onChange={(e) => setReason(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={saving || !reason.trim()} onClick={handleSave}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}

function ImpersonateDialog({ tenant, onClose }: { tenant: TenantSummary; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setSaving(true);
    setError(null);
    try {
      const result = await startImpersonation(tenant.id, reason);
      const ssoPayload = base64UrlEncode(JSON.stringify({
        token: result.token,
        tenant: result.tenant,
        user: result.user,
        impersonation: { sessionId: result.impersonationSessionId, expiresAt: result.expiresAt },
      }));
      window.open(`${window.location.origin}/dashboard?sso=${ssoPayload}`, "_blank", "noopener");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Iniciar sessão de suporte (impersonation)</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Abre uma nova aba logada como o OWNER deste tenant, por até 30 minutos. Obrigatório informar o motivo — fica registrado no audit log.
        </Typography>
        <TextField fullWidth multiline minRows={2} label="Motivo" size="small" value={reason} onChange={(e) => setReason(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={saving || reason.trim().length < 5} onClick={handleStart}>Iniciar</Button>
      </DialogActions>
    </Dialog>
  );
}

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { admin } = usePlatformAdminAuth();
  const canEdit = admin?.role === "SUPER_ADMIN";
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [sessions, setSessions] = useState<ImpersonationSessionRecord[] | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [impersonateDialogOpen, setImpersonateDialogOpen] = useState(false);

  async function reload() {
    if (!id) return;
    try {
      setTenant(await getTenant(id));
      setSessions(await listImpersonationSessions(id));
      setLogs(await listAuditLogs({ targetType: "Tenant", targetId: id }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <Box sx={{ p: 3 }}><Alert severity="error">{error}</Alert></Box>;
  if (!tenant) return <Box sx={{ p: 3 }}><Typography>Carregando…</Typography></Box>;

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h5">{tenant.tradeName}</Typography>
        <Chip label={tenant.status} color={tenant.status === "ACTIVE" ? "success" : tenant.status === "TRIAL" ? "default" : "error"} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {tenant.legalName} • {tenant.slug} • {tenant.tenantType} • CNPJ: {tenant.cnpj ?? "—"}
      </Typography>

      {canEdit && (
        <Stack direction="row" spacing={2} sx={{ mb: 4 }}>
          <Button variant="outlined" onClick={() => setStatusDialogOpen(true)}>Alterar status</Button>
          <Button variant="contained" onClick={() => setImpersonateDialogOpen(true)}>Iniciar sessão de suporte (impersonation)</Button>
        </Stack>
      )}

      <Typography variant="h6" sx={{ mb: 2 }}>Sessões de impersonation</Typography>
      <TableContainer component={Paper} sx={{ mb: 4 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Admin</TableCell>
              <TableCell>Motivo</TableCell>
              <TableCell>Iniciada em</TableCell>
              <TableCell>Expira em</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(sessions ?? []).map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.platformAdminUser.name}</TableCell>
                <TableCell>{s.reason}</TableCell>
                <TableCell>{new Date(s.startedAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell>{new Date(s.expiresAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell>
                  <Chip size="small" color={s.endedAt ? "default" : "warning"} label={s.endedAt ? "Encerrada" : "Em andamento"} />
                </TableCell>
              </TableRow>
            ))}
            {sessions && sessions.length === 0 && <TableRow><TableCell colSpan={5}>Nenhuma sessão de impersonation.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="h6" sx={{ mb: 2 }}>Audit log deste tenant</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Ação</TableCell>
              <TableCell>Quando</TableCell>
              <TableCell>Detalhes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(logs ?? []).map((log) => (
              <TableRow key={log.id}>
                <TableCell>{log.action}</TableCell>
                <TableCell>{new Date(log.createdAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell><code style={{ fontSize: 11 }}>{JSON.stringify(log.metadata)}</code></TableCell>
              </TableRow>
            ))}
            {logs && logs.length === 0 && <TableRow><TableCell colSpan={3}>Nenhum evento registrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>

      {statusDialogOpen && (
        <StatusDialog tenant={tenant} onClose={() => setStatusDialogOpen(false)} onSaved={(t) => setTenant(t)} />
      )}
      {impersonateDialogOpen && (
        <ImpersonateDialog tenant={tenant} onClose={() => { setImpersonateDialogOpen(false); void reload(); }} />
      )}
    </Box>
  );
}
