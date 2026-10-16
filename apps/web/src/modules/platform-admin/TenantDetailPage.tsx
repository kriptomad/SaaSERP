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
import {
  getTenant,
  TenantSummary,
  updateTenantStatus,
  startImpersonation,
  listImpersonationSessions,
  ImpersonationSessionRecord,
  listAuditLogs,
  AuditLogEntry,
  listTenantApiKeys,
  revokeTenantApiKey,
  TenantApiKeySummary,
  listTenantWebhookEndpoints,
  listWebhookDeliveries,
  replayWebhookDelivery,
  TenantWebhookEndpointSummary,
  WebhookDeliverySummary,
} from "./platform-admin-ops.api";

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

// GAP DE AUDITORIA FECHADO (mega-audit rodada 8): oversight de API keys e
// webhooks do tenant já existia no backend, sem nenhuma tela do painel de
// plataforma o consumindo — o dono do SaaS dependia de acesso direto ao banco
// para revogar a chave de um tenant comprometido ou investigar/reenviar uma
// entrega de webhook falha.
function TenantApiKeysSection({ tenantId }: { tenantId: string }) {
  const { admin } = usePlatformAdminAuth();
  const canEdit = admin?.role === "SUPER_ADMIN";
  const [keys, setKeys] = useState<TenantApiKeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setKeys(await listTenantApiKeys(tenantId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function handleRevoke(id: string) {
    try {
      await revokeTenantApiKey(id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Chaves de API deste tenant</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Rótulo</TableCell>
              <TableCell>Prefixo</TableCell>
              <TableCell>Escopos</TableCell>
              <TableCell>Último uso</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(keys ?? []).map((k) => (
              <TableRow key={k.id}>
                <TableCell>{k.label}</TableCell>
                <TableCell><code>{k.keyPrefix}…</code></TableCell>
                <TableCell>{k.scopes.join(", ")}</TableCell>
                <TableCell>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("pt-BR") : "Nunca usada"}</TableCell>
                <TableCell>
                  <Chip size="small" color={k.revokedAt ? "default" : "success"} label={k.revokedAt ? "Revogada" : "Ativa"} />
                </TableCell>
                <TableCell>
                  {canEdit && !k.revokedAt && (
                    <Button size="small" color="error" onClick={() => handleRevoke(k.id)}>Revogar</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {keys && keys.length === 0 && <TableRow><TableCell colSpan={6}>Nenhuma chave de API gerada por este tenant.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function WebhookDeliveriesDialog({ endpoint, onClose }: { endpoint: TenantWebhookEndpointSummary; onClose: () => void }) {
  const [deliveries, setDeliveries] = useState<WebhookDeliverySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setDeliveries(await listWebhookDeliveries(endpoint.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint.id]);

  async function handleReplay(id: string) {
    try {
      await replayWebhookDelivery(id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Entregas — {endpoint.url}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Evento</TableCell>
              <TableCell align="right">HTTP</TableCell>
              <TableCell align="right">Tentativas</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Entregue em</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(deliveries ?? []).map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.eventType}</TableCell>
                <TableCell align="right">{d.statusCode ?? "—"}</TableCell>
                <TableCell align="right">{d.attemptCount}</TableCell>
                <TableCell><Chip size="small" color={d.success ? "success" : "error"} label={d.success ? "Sucesso" : "Falha"} /></TableCell>
                <TableCell>{new Date(d.deliveredAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell>
                  {!d.success && <Button size="small" onClick={() => handleReplay(d.id)}>Reenviar</Button>}
                </TableCell>
              </TableRow>
            ))}
            {deliveries && deliveries.length === 0 && <TableRow><TableCell colSpan={6}>Nenhuma entrega registrada ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

function TenantWebhooksSection({ tenantId }: { tenantId: string }) {
  const [endpoints, setEndpoints] = useState<TenantWebhookEndpointSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<TenantWebhookEndpointSummary | null>(null);

  useEffect(() => {
    listTenantWebhookEndpoints(tenantId).then(setEndpoints).catch((err) => setError((err as Error).message));
  }, [tenantId]);

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Webhooks configurados pelo tenant</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>URL</TableCell>
              <TableCell>Eventos</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Criado em</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(endpoints ?? []).map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.url}</TableCell>
                <TableCell>{e.eventTypes.join(", ")}</TableCell>
                <TableCell><Chip size="small" color={e.active ? "success" : "default"} label={e.active ? "Ativo" : "Inativo"} /></TableCell>
                <TableCell>{new Date(e.createdAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell><Button size="small" onClick={() => setSelectedEndpoint(e)}>Ver entregas</Button></TableCell>
              </TableRow>
            ))}
            {endpoints && endpoints.length === 0 && <TableRow><TableCell colSpan={5}>Nenhum webhook configurado por este tenant.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      {selectedEndpoint && (
        <WebhookDeliveriesDialog endpoint={selectedEndpoint} onClose={() => setSelectedEndpoint(null)} />
      )}
    </Box>
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

      <TenantApiKeysSection tenantId={tenant.id} />
      <TenantWebhooksSection tenantId={tenant.id} />

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
