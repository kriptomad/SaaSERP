// apps/web/src/pages/StatusPage.tsx
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 9, Capítulo 15.1.5): página
// de status pública, sem autenticação — pensada para ser aberta numa visita/reunião
// com cliente (o próprio admin/dono do SaaS a usa como prova social de
// transparência) ou monitorada por ferramentas externas de uptime. Mostra só o
// essencial (operacional/degradado/indisponível), nunca detalhe operacional interno
// (profundidade de fila, latência exata, nomes técnicos) — isso fica em
// /platform-admin/status, autenticado.
import { useEffect, useState, useCallback } from "react";
import { Alert, Box, Chip, Divider, Paper, Stack, Typography } from "@mui/material";
import { resolveApiBaseUrl } from "../api/client";

type ComponentStatus = "operational" | "degraded" | "outage";

interface PublicStatusResponse {
  overallStatus: ComponentStatus;
  overallStatusLabel: string;
  checkedAt: string;
  components: { name: string; status: ComponentStatus; statusLabel: string }[];
}

interface PublicIncident {
  id: string;
  componentLabel: string;
  severity: "WARNING" | "CRITICAL";
  description: string;
  startedAt: string;
  resolvedAt: string | null;
}

const STATUS_COLOR: Record<ComponentStatus, "success" | "warning" | "error"> = {
  operational: "success",
  degraded: "warning",
  outage: "error",
};

function formatDuration(startedAt: string, resolvedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  const minutes = Math.max(1, Math.round((end - start) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return `${hours}h ${rem}min`;
}

export function StatusPage() {
  const [data, setData] = useState<PublicStatusResponse | null>(null);
  const [incidents, setIncidents] = useState<PublicIncident[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`${resolveApiBaseUrl()}/status`)
      .then((res) => res.json())
      .then((body) => setData(body.data as PublicStatusResponse))
      .catch(() => setError("Não foi possível carregar o status no momento."));
    fetch(`${resolveApiBaseUrl()}/status/incidents`)
      .then((res) => res.json())
      .then((body) => setIncidents((body.data as PublicIncident[]) ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <Box sx={{ display: "flex", justifyContent: "center", minHeight: "100vh", bgcolor: "background.default", py: 6 }}>
      <Paper elevation={2} sx={{ p: 4, width: 560, maxWidth: "100%" }}>
        <Typography variant="h5" gutterBottom>Status da plataforma Filitech ERP</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {data && (
          <>
            <Alert severity={data.overallStatus === "operational" ? "success" : data.overallStatus === "degraded" ? "warning" : "error"} sx={{ mb: 3 }}>
              {data.overallStatusLabel}
            </Alert>
            <Stack spacing={1.5}>
              {data.components.map((c) => (
                <Box key={c.name} sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="body1">{c.name}</Typography>
                  <Chip size="small" color={STATUS_COLOR[c.status]} label={c.statusLabel} />
                </Box>
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: "block" }}>
              Última verificação: {new Date(data.checkedAt).toLocaleString("pt-BR")} — atualiza automaticamente a cada 30s.
            </Typography>

            <Divider sx={{ my: 3 }} />
            <Typography variant="h6" gutterBottom>Histórico de incidentes (últimos 90 dias)</Typography>
            {incidents.length === 0 && (
              <Typography variant="body2" color="text.secondary">Nenhum incidente registrado no período.</Typography>
            )}
            <Stack spacing={1.5}>
              {incidents.map((incident) => (
                <Box key={incident.id} sx={{ borderLeft: 3, borderColor: incident.resolvedAt ? "success.main" : "error.main", pl: 1.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      size="small"
                      color={incident.resolvedAt ? "default" : incident.severity === "CRITICAL" ? "error" : "warning"}
                      label={incident.resolvedAt ? "Resolvido" : "Em andamento"}
                    />
                    <Typography variant="body2" fontWeight={600}>{incident.componentLabel}</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">{incident.description}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(incident.startedAt).toLocaleString("pt-BR")} — duração: {formatDuration(incident.startedAt, incident.resolvedAt)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </>
        )}
      </Paper>
    </Box>
  );
}
