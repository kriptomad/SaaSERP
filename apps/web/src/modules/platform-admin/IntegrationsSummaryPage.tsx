// apps/web/src/modules/platform-admin/IntegrationsSummaryPage.tsx
// Capítulo 20.10 — visão agregada por provedor de integração (SEFAZ, TEF, Correios,
// WhatsApp, etc.): quantos tenants têm a credencial ativa e a taxa de sucesso dos
// últimos 100 health-checks, para o dono do SaaS detectar em massa (ex.) uma
// mudança de layout da SEFAZ ou expiração em lote de tokens antes que o lojista
// perceba no caixa.
// GAP DE AUDITORIA FECHADO (mega-audit rodada 8): o endpoint
// `GET /platform-admin/integrations/summary` existia desde a rodada anterior, mas
// nenhuma tela do painel de plataforma o consumia.
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { fetchIntegrationsSummary, IntegrationProviderSummary } from "./platform-admin-ops.api";

function successRateColor(rate: number | null): "success" | "warning" | "error" | "default" {
  if (rate === null) return "default";
  if (rate >= 0.95) return "success";
  if (rate >= 0.8) return "warning";
  return "error";
}

export function IntegrationsSummaryPage() {
  const [summary, setSummary] = useState<IntegrationProviderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIntegrationsSummary()
      .then(setSummary)
      .catch((err) => setError((err as Error).message));
  }, []);

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Central de integrações</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Visão agregada por provedor — nunca por tenant isolado. Útil para detectar em massa uma mudança de layout de
        um órgão (SEFAZ, ANVISA) ou expiração em lote de credenciais antes que o lojista perceba no caixa. Os dados
        reaproveitam os health-checks já gravados pelos próprios conectores, sem nenhuma chamada de rede nova.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!summary && !error && <LinearProgress sx={{ mb: 2 }} />}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Provedor</TableCell>
              <TableCell align="right">Tenants com credencial ativa</TableCell>
              <TableCell align="right">Total de credenciais</TableCell>
              <TableCell align="right">Amostra (últimos health-checks)</TableCell>
              <TableCell align="right">Taxa de sucesso</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(summary ?? []).map((row) => (
              <TableRow key={row.provider}>
                <TableCell>{row.provider}</TableCell>
                <TableCell align="right">{row.activeTenantCount}</TableCell>
                <TableCell align="right">{row.totalCredentialCount}</TableCell>
                <TableCell align="right">{row.sampledChecks}</TableCell>
                <TableCell align="right">
                  <Chip
                    size="small"
                    color={successRateColor(row.last100SuccessRate)}
                    label={row.last100SuccessRate === null ? "Sem amostra" : `${Math.round(row.last100SuccessRate * 100)}%`}
                  />
                </TableCell>
              </TableRow>
            ))}
            {summary && summary.length === 0 && (
              <TableRow><TableCell colSpan={5}>Nenhuma credencial de integração cadastrada em nenhum tenant.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
