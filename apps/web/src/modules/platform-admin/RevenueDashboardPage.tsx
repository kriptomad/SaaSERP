// apps/web/src/modules/platform-admin/RevenueDashboardPage.tsx
// Capítulo 13.3 — MRR/ARR calculados em tempo real a partir das assinaturas ativas,
// nunca um número estático. Sem gráficos externos (sem libs novas): cartões simples
// e tabela por plano, consistente com o resto do painel.
import { useEffect, useState } from "react";
import { Alert, Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { fetchRevenueDashboard, RevenueDashboard } from "./platform-admin-ops.api";

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Paper sx={{ p: 2, flex: 1, minWidth: 180 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h5">{value}</Typography>
    </Paper>
  );
}

export function RevenueDashboardPage() {
  const [data, setData] = useState<RevenueDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRevenueDashboard().then(setData).catch((err) => setError((err as Error).message));
  }, []);

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Dashboard de receita (MRR)</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Calculado a partir de assinaturas com status ACTIVE — nunca uma estimativa.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {data && (
        <>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 4 }}>
            <MetricCard label="MRR" value={formatBRL(data.totalMrr)} />
            <MetricCard label="ARR (projetado)" value={formatBRL(data.arr)} />
            <MetricCard label="Assinaturas totais" value={String(data.totalSubscriptions)} />
            <MetricCard label="Churn este mês" value={String(data.churnedThisMonth)} />
          </Stack>

          <Typography variant="h6" sx={{ mb: 2 }}>Por status de assinatura</Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 4 }}>
            {Object.entries(data.countByStatus).map(([status, count]) => (
              <Chip key={status} label={`${status}: ${count}`} />
            ))}
          </Stack>

          <Typography variant="h6" sx={{ mb: 2 }}>MRR por plano</Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Plano</TableCell>
                  <TableCell align="right">Assinantes ativos</TableCell>
                  <TableCell align="right">MRR</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.byPlan.map((plan) => (
                  <TableRow key={plan.planCode}>
                    <TableCell>{plan.planLabel} ({plan.planCode})</TableCell>
                    <TableCell align="right">{plan.activeCount}</TableCell>
                    <TableCell align="right">{formatBRL(plan.mrr)}</TableCell>
                  </TableRow>
                ))}
                {data.byPlan.length === 0 && <TableRow><TableCell colSpan={3}>Nenhuma assinatura ativa.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
