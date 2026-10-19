// apps/desktop/src/screens/HostDashboard.tsx
// Painel principal do modo HOST: status de saúde do backend, da fila (Redis/BullMQ) e
// das rotas críticas, além de atalho para abrir a janela do ERP (apps/web) e para
// reconfigurar rede. "Usuários conectados agora" é alimentado por GET /me em cada
// terminal — nesta v1 o dashboard mostra o ping agregado do backend; a lista nominal de
// sessões ativas depende de um endpoint `GET /admin/active-sessions` (pendência, ver
// README.md) pois o módulo de sessões atual (Capítulo 14) não expõe isso publicamente.
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import CircularProgress from "@mui/material/CircularProgress";
import { getDesktopApi, type DesktopConfig, type BackendState, type HealthPingResult } from "../api/desktopApi";

const CRITICAL_ROUTES = ["/health", "/auth", "/sales", "/cash-registers/current"];

export function HostDashboard({ config }: { config: DesktopConfig }) {
  const [backendState, setBackendState] = useState<BackendState | null>(null);
  const [routeHealth, setRouteHealth] = useState<Record<string, HealthPingResult>>({});
  const [refreshing, setRefreshing] = useState(false);

  const apiBaseUrl = `http://127.0.0.1:${config.network.port}`;
  // CORREÇÃO DE AUDITORIA (fa-desktop-host-dashboard-refresh-stuck): `requestIdRef`
  // é um contador monotônico — cada chamada a `refreshHealth` recebe um id próprio;
  // se uma chamada mais nova já começou quando uma mais antiga termina (overlap do
  // intervalo de 30s com um clique manual em "Atualizar status", por exemplo), o
  // resultado desatualizado é descartado em vez de sobrescrever o estado mais recente.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const api = getDesktopApi();
    api.backend.status().then(setBackendState);
    const unsubscribe = api.backend.onStatusChanged(setBackendState);
    return unsubscribe;
  }, []);

  async function refreshHealth() {
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    try {
      const api = getDesktopApi();
      const settled = await Promise.allSettled(CRITICAL_ROUTES.map((route) => api.network.pingUrl(`${apiBaseUrl}${route}`)));
      if (requestId !== requestIdRef.current) return; // uma chamada mais nova já assumiu — descarta este resultado
      const results: Record<string, HealthPingResult> = {};
      settled.forEach((outcome, index) => {
        const route = CRITICAL_ROUTES[index];
        results[route] =
          outcome.status === "fulfilled" ? outcome.value : { ok: false, latencyMs: null, detail: outcome.reason instanceof Error ? outcome.reason.message : "Falha ao verificar rota." };
      });
      setRouteHealth(results);
    } finally {
      if (requestId === requestIdRef.current) setRefreshing(false);
    }
  }

  useEffect(() => {
    refreshHealth();
    const interval = setInterval(refreshHealth, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box sx={{ p: 4, height: "100vh", overflow: "auto" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h5">Painel do servidor (modo HOST)</Typography>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" onClick={refreshHealth} disabled={refreshing}>
            {refreshing ? <CircularProgress size={18} /> : "Atualizar status"}
          </Button>
          <Button variant="contained" onClick={() => getDesktopApi().window.openErp()}>
            Abrir Filitech ERP
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Backend local
              </Typography>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                <StatusChip status={backendState?.status ?? "STOPPED"} />
                <Typography variant="body2">PID {backendState?.pid ?? "—"}</Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Bind: {config.network.bindAddress}:{config.network.port}
              </Typography>
              {backendState?.lastError && (
                <Typography variant="caption" color="error" display="block">
                  {backendState.lastError}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Fila (Redis/BullMQ)
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Ping via `/health` — a checagem dedicada de fila depende de
                `REDIS_URL` configurado no ambiente do backend local.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Backup
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                {config.network.backupSchedule === "DISABLED"
                  ? "Backup automático desativado"
                  : `Agendamento: ${config.network.backupSchedule === "DAILY" ? "diário" : "semanal"}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Pasta: {config.network.backupFolderPath ?? "não configurada"}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="h6" sx={{ mb: 2 }}>
        Rotas críticas
      </Typography>
      <Stack spacing={1}>
        {CRITICAL_ROUTES.map((route) => (
          <Stack key={route} direction="row" spacing={2} alignItems="center">
            <Typography variant="body2" sx={{ minWidth: 220, fontFamily: "monospace" }}>
              {route}
            </Typography>
            {routeHealth[route] ? (
              <>
                <Chip
                  size="small"
                  color={routeHealth[route].ok ? "success" : "error"}
                  label={routeHealth[route].ok ? "OK" : "Indisponível"}
                />
                <Typography variant="caption" color="text.secondary">
                  {routeHealth[route].latencyMs != null ? `${routeHealth[route].latencyMs}ms` : routeHealth[route].detail}
                </Typography>
              </>
            ) : (
              <CircularProgress size={14} />
            )}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

function StatusChip({ status }: { status: BackendState["status"] }) {
  const map: Record<BackendState["status"], { label: string; color: "success" | "warning" | "error" | "default" }> = {
    RUNNING: { label: "Rodando", color: "success" },
    STARTING: { label: "Iniciando...", color: "warning" },
    STOPPED: { label: "Parado", color: "default" },
    ERROR: { label: "Erro", color: "error" },
  };
  const { label, color } = map[status];
  return <Chip size="small" color={color} label={label} />;
}
