// apps/web/src/pages/StatusPage.tsx
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 9, Capítulo 15.1.5): página
// de status pública, sem autenticação — pensada para ser aberta numa visita/reunião
// com cliente (o próprio admin/dono do SaaS a usa como prova social de
// transparência) ou monitorada por ferramentas externas de uptime. Mostra só o
// essencial (operacional/degradado/indisponível), nunca detalhe operacional interno
// (profundidade de fila, latência exata, nomes técnicos) — isso fica em
// /platform-admin/status, autenticado.
import { useEffect, useState, useCallback } from "react";
import { Alert, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { resolveApiBaseUrl } from "../api/client";

type ComponentStatus = "operational" | "degraded" | "outage";

interface PublicStatusResponse {
  overallStatus: ComponentStatus;
  overallStatusLabel: string;
  checkedAt: string;
  components: { name: string; status: ComponentStatus; statusLabel: string }[];
}

const STATUS_COLOR: Record<ComponentStatus, "success" | "warning" | "error"> = {
  operational: "success",
  degraded: "warning",
  outage: "error",
};

export function StatusPage() {
  const [data, setData] = useState<PublicStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`${resolveApiBaseUrl()}/status`)
      .then((res) => res.json())
      .then((body) => setData(body.data as PublicStatusResponse))
      .catch(() => setError("Não foi possível carregar o status no momento."));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <Box sx={{ display: "flex", justifyContent: "center", minHeight: "100vh", bgcolor: "background.default", py: 6 }}>
      <Paper elevation={2} sx={{ p: 4, width: 520, maxWidth: "100%" }}>
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
          </>
        )}
      </Paper>
    </Box>
  );
}
