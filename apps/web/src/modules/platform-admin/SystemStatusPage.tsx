// apps/web/src/modules/platform-admin/SystemStatusPage.tsx
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 9, Capítulo 15.1): dashboard
// de saúde do sistema para o painel interno — banco, Redis e as 15 filas BullMQ,
// com profundidade/falhas visíveis (informação operacional, nunca exposta na
// página pública /status). Atualização automática a cada 15s, sem WebSocket/SSE —
// não há necessidade de tempo real estrito aqui, só uma visão corrente.
import { useEffect, useState, useCallback } from "react";
import { Alert, Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { fetchSystemStatus, SystemStatusSnapshot, ComponentStatus } from "./system-status.api";

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

  const refresh = useCallback(() => {
    fetchSystemStatus()
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Status do sistema</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Snapshot ao vivo — banco de dados, Redis e todas as filas de processamento em segundo plano (BullMQ). Atualiza a cada 15s.
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
        </>
      )}
    </Box>
  );
}
