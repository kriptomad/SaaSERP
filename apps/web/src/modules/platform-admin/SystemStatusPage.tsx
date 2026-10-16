// apps/web/src/modules/platform-admin/SystemStatusPage.tsx
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 9, Capítulo 15.1): dashboard
// de saúde do sistema para o painel interno — banco, Redis e as 15 filas BullMQ,
// com profundidade/falhas visíveis (informação operacional, nunca exposta na
// página pública /status).
// GAP DE AUDITORIA FECHADO (mega-audit round 3, r3-health-dashboard-realtime):
// antes atualizava via `setInterval(refresh, 15_000)` (polling HTTP simples). Agora
// consome `GET /platform-admin/system-status/stream` via SSE
// (`useSseStream`, com `getStoredPlatformAdminToken` — sessão de administração de
// plataforma é separada da sessão de tenant) — o servidor empurra uma nova leitura
// a cada 5s sem o cliente reabrir conexão HTTP repetidamente. Fallback automático:
// se o SSE cair, `useSseStream` reconecta sozinho com backoff; mantemos também uma
// leitura via `GET` simples no primeiro render para já exibir dado antes do
// primeiro evento SSE chegar.
import { useEffect, useState, useCallback } from "react";
import { Alert, Box, Button, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { fetchSystemStatus, SystemStatusSnapshot, ComponentStatus, listIncidents, createIncident, updateIncident, IncidentEventRecord } from "./system-status.api";
import { useSseStream } from "../../shared/useSseStream";
import { getStoredPlatformAdminToken } from "./platform-admin-client";

const STATUS_COLOR: Record<ComponentStatus, "success" | "warning" | "error"> = {
  operational: "success",
  degraded: "warning",
  outage: "error",
};

const STATUS_LABEL: Record<ComponentStatus, string> = {
  operational: "Operacional",
  degraded: "Degradado",
  outage: "Indisponível",
};

function StatusChip({ status }: { status: ComponentStatus }) {
  return <Chip size="small" color={STATUS_COLOR[status]} label={STATUS_LABEL[status]} />;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}min`;
}

export function SystemStatusPage() {
  const [data, setData] = useState<SystemStatusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [incidents, setIncidents] = useState<IncidentEventRecord[]>([]);
  const [newIncident, setNewIncident] = useState<{ component: "DATABASE" | "REDIS" | "BACKGROUND_JOBS"; severity: "WARNING" | "CRITICAL"; description: string }>({
    component: "DATABASE",
    severity: "WARNING",
    description: "",
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmittingIncident, setIsSubmittingIncident] = useState(false);
  const [resolvingIncidentId, setResolvingIncidentId] = useState<string | null>(null);

  const refreshIncidents = useCallback(() => {
    listIncidents().then(setIncidents).catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchSystemStatus()
      .then(setData)
      .catch((err) => setError((err as Error).message));
    refreshIncidents();
  }, [refreshIncidents]);

  // CORREÇÃO DE AUDITORIA (mega-audit rodada 7): os handlers de criar/resolver
  // incidente não tinham try/catch — se a chamada falhasse (ex.: sessão de admin
  // de plataforma expirada, rede instável), o erro ficava só no console do
  // navegador, sem NENHUM feedback visual para o operador, que achava que a ação
  // tinha funcionado silenciosamente.
  async function handleCreateIncident() {
    if (!newIncident.description.trim()) return;
    setActionError(null);
    setIsSubmittingIncident(true);
    try {
      await createIncident(newIncident);
      setNewIncident({ component: "DATABASE", severity: "WARNING", description: "" });
      refreshIncidents();
    } catch (err) {
      setActionError(`Falha ao registrar incidente: ${(err as Error).message}`);
    } finally {
      setIsSubmittingIncident(false);
    }
  }

  async function handleResolveIncident(id: string) {
    setActionError(null);
    setResolvingIncidentId(id);
    try {
      await updateIncident(id, { resolvedAt: new Date().toISOString() });
      refreshIncidents();
    } catch (err) {
      setActionError(`Falha ao marcar incidente como resolvido: ${(err as Error).message}`);
    } finally {
      setResolvingIncidentId(null);
    }
  }

  const handleSseEvent = useCallback((event: { type: string; data: unknown }) => {
    if (event.type !== "status") return;
    setData(event.data as SystemStatusSnapshot);
    setError(null);
    setLive(true);
  }, []);

  useSseStream("/platform-admin/system-status/stream", handleSseEvent, true, getStoredPlatformAdminToken);

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Status do sistema</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {live ? "Ao vivo (SSE)" : "Conectando..."} — banco de dados, Redis e todas as filas de processamento em segundo plano (BullMQ). Atualiza a cada 5s.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {data && (
        <>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
            <Paper sx={{ p: 2, flex: 1, minWidth: 200 }}>
              <Typography variant="body2" color="text.secondary">Status geral</Typography>
              <Box sx={{ mt: 1 }}><StatusChip status={data.overallStatus} /></Box>
            </Paper>
            <Paper sx={{ p: 2, flex: 1, minWidth: 200 }}>
              <Typography variant="body2" color="text.secondary">Banco de dados</Typography>
              <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1 }}>
                <StatusChip status={data.database.status} />
                {data.database.latencyMs !== null && <Typography variant="caption">{data.database.latencyMs}ms</Typography>}
              </Box>
            </Paper>
            <Paper sx={{ p: 2, flex: 1, minWidth: 200 }}>
              <Typography variant="body2" color="text.secondary">Redis</Typography>
              <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1 }}>
                <StatusChip status={data.redis.status} />
                {data.redis.latencyMs !== null && <Typography variant="caption">{data.redis.latencyMs}ms</Typography>}
              </Box>
            </Paper>
            <Paper sx={{ p: 2, flex: 1, minWidth: 200 }}>
              <Typography variant="body2" color="text.secondary">Processo API</Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>Uptime: {formatUptime(data.processUptimeSeconds)}</Typography>
              <Typography variant="caption" color="text.secondary">Node {data.nodeVersion}</Typography>
            </Paper>
          </Stack>

          <Typography variant="h6" sx={{ mb: 2 }}>Filas de processamento (BullMQ)</Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Fila</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Aguardando</TableCell>
                  <TableCell align="right">Em execução</TableCell>
                  <TableCell align="right">Atrasados</TableCell>
                  <TableCell align="right">Falhados</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.queues.map((q) => (
                  <TableRow key={q.name}>
                    <TableCell>{q.label}</TableCell>
                    <TableCell><StatusChip status={q.status} /></TableCell>
                    <TableCell align="right">{q.waiting}</TableCell>
                    <TableCell align="right">{q.active}</TableCell>
                    <TableCell align="right">{q.delayed}</TableCell>
                    <TableCell align="right">{q.failed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="h6" sx={{ mt: 4, mb: 2 }}>
            Incidentes (histórico + registro manual — refletido na página pública /status)
          </Typography>
          <Paper sx={{ p: 2, mb: 2 }}>
            {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
              <TextField
                select
                size="small"
                label="Componente"
                value={newIncident.component}
                onChange={(e) => setNewIncident((prev) => ({ ...prev, component: e.target.value as typeof prev.component }))}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="DATABASE">Banco de dados</MenuItem>
                <MenuItem value="REDIS">Redis / Cache</MenuItem>
                <MenuItem value="BACKGROUND_JOBS">Processamento em segundo plano</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                label="Severidade"
                value={newIncident.severity}
                onChange={(e) => setNewIncident((prev) => ({ ...prev, severity: e.target.value as typeof prev.severity }))}
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="WARNING">Aviso</MenuItem>
                <MenuItem value="CRITICAL">Crítico</MenuItem>
              </TextField>
              <TextField
                size="small"
                label="Descrição pública"
                value={newIncident.description}
                onChange={(e) => setNewIncident((prev) => ({ ...prev, description: e.target.value }))}
                sx={{ flex: 1, minWidth: 260 }}
              />
              <Button variant="contained" onClick={handleCreateIncident} disabled={!newIncident.description.trim() || isSubmittingIncident}>
                {isSubmittingIncident ? "Registrando..." : "Registrar incidente"}
              </Button>
            </Stack>
          </Paper>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Componente</TableCell>
                  <TableCell>Severidade</TableCell>
                  <TableCell>Descrição</TableCell>
                  <TableCell>Início</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Ação</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {incidents.map((incident) => (
                  <TableRow key={incident.id}>
                    <TableCell>{incident.component}</TableCell>
                    <TableCell>{incident.severity}</TableCell>
                    <TableCell>{incident.description}</TableCell>
                    <TableCell>{new Date(incident.startedAt).toLocaleString("pt-BR")}</TableCell>
                    <TableCell>
                      <Chip size="small" color={incident.resolvedAt ? "default" : "error"} label={incident.resolvedAt ? "Resolvido" : "Em andamento"} />
                    </TableCell>
                    <TableCell align="right">
                      {!incident.resolvedAt && (
                        <Button size="small" onClick={() => handleResolveIncident(incident.id)} disabled={resolvingIncidentId === incident.id}>
                          {resolvingIncidentId === incident.id ? "Resolvendo..." : "Marcar resolvido"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {incidents.length === 0 && <TableRow><TableCell colSpan={6}>Nenhum incidente registrado.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
