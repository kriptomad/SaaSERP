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
            <MetricCard label="MRR projetado (+3 meses)" value={formatBRL(data.projectedMrrIn3Months)} />
            <MetricCard label="Assinaturas totais" value={String(data.totalSubscriptions)} />
            <MetricCard label="Churn este mês" value={String(data.churnedThisMonth)} />
          </Stack>

          <Typography variant="h6" sx={{ mb: 2 }}>Por status de assinatura</Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 4 }}>
            {Object.entries(data.countByStatus).map(([status, count]) => (
              <Chip key={status} label={`${status}: ${count}`} />
            ))}
          </Stack>

          <Typography variant="h6" sx={{ mb: 2 }}>MRR por plano (base) e LTV estimado</Typography>
          <TableContainer component={Paper} sx={{ mb: 4 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Plano</TableCell>
                  <TableCell align="right">Assinantes ativos</TableCell>
                  <TableCell align="right">MRR</TableCell>
                  <TableCell align="right">ARPU</TableCell>
                  <TableCell align="right">LTV estimado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.byPlan.map((plan) => {
                  const ltv = data.ltvByPlan.find((l) => l.planCode === plan.planCode);
                  return (
                    <TableRow key={plan.planCode}>
                      <TableCell>{plan.planLabel} ({plan.planCode})</TableCell>
                      <TableCell align="right">{plan.activeCount}</TableCell>
                      <TableCell align="right">{formatBRL(plan.mrr)}</TableCell>
                      <TableCell align="right">{ltv ? formatBRL(ltv.arpu) : "—"}</TableCell>
                      <TableCell align="right">{ltv?.ltv != null ? formatBRL(ltv.ltv) : "Sem churn observado"}</TableCell>
                    </TableRow>
                  );
                })}
                {data.byPlan.length === 0 && <TableRow><TableCell colSpan={5}>Nenhuma assinatura ativa.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="h6" sx={{ mb: 2 }}>
            MRR por módulo add-on (total: {formatBRL(data.totalModuleMrr)})
          </Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Módulo</TableCell>
                  <TableCell align="right">Tenants ativos</TableCell>
                  <TableCell align="right">MRR</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.byModule.map((m) => (
                  <TableRow key={m.moduleCode}>
                    <TableCell>{m.moduleLabel} ({m.moduleCode})</TableCell>
                    <TableCell align="right">{m.activeTenantCount}</TableCell>
                    <TableCell align="right">{formatBRL(m.mrr)}</TableCell>
                  </TableRow>
                ))}
                {data.byModule.length === 0 && <TableRow><TableCell colSpan={3}>Nenhum módulo add-on ativo.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
