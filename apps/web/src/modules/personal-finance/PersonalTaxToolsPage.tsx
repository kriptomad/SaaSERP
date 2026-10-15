// apps/web/src/modules/personal-finance/PersonalTaxToolsPage.tsx
// Capítulo 22.7 — ferramentas fiscais B2C: cálculo mensal do Carnê-Leão para
// autônomos/profissionais liberais que recebem via conta pessoal.
import { useState } from "react";
import { Alert, Button, Grid, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { Page, PageHeader, errorMessage } from "../../shared/ui/PageLayout";
import { money } from "../../shared/ui/format";
import { personalFinanceApi, type CarneLeaoResult } from "./api";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function PersonalTaxToolsPage() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [result, setResult] = useState<CarneLeaoResult | null>(null);

  const mutation = useMutation({
    mutationFn: () => personalFinanceApi.carneLeao(`${year}-${month}`),
    onSuccess: (data) => setResult(data),
  });

  const years = Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i));

  return (
    <Page>
      <PageHeader title="Carnê-Leão" subtitle="Apuração mensal do imposto de renda devido sobre rendimentos recebidos de pessoas físicas ou do exterior." />
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <TextField select label="Mês" value={month} onChange={(e) => setMonth(e.target.value)} sx={{ minWidth: 160 }}>
            {MONTHS.map((label, idx) => (
              <MenuItem key={label} value={String(idx + 1).padStart(2, "0")}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Ano" value={year} onChange={(e) => setYear(e.target.value)} sx={{ minWidth: 140 }}>
            {years.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="contained" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Calculando…" : "Calcular"}
          </Button>
        </Stack>
      </Paper>

      {mutation.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(mutation.error)}</Alert>}

      {result && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Rendimento tributável no mês</Typography>
              <Typography variant="h5">{money(result.rendimentoTributavel)}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Alíquota aplicada</Typography>
              <Typography variant="h5">{(result.aliquotaAplicada * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Imposto sugerido (DARF)</Typography>
              <Typography variant="h5">{money(result.impostoSugerido)}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Código DARF / Vencimento</Typography>
              <Typography variant="h5">
                {result.codigoDarf} — {new Date(result.vencimento).toLocaleDateString("pt-BR")}
              </Typography>
            </Grid>
          </Grid>
          <Alert severity="info" sx={{ mt: 3 }}>
            {result.disclaimer}
          </Alert>
        </Paper>
      )}
    </Page>
  );
}
