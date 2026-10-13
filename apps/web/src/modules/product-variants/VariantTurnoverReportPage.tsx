// apps/web/src/modules/product-variants/VariantTurnoverReportPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.6 — Varejo Geral: relatório gerencial de
// giro de estoque por grade/variante, citado explicitamente no enunciado do nicho e
// até então inexistente (grades/variantes tinham CRUD maduro, mas nenhum relatório
// agregado). Consome GET /product-variants/turnover-report (periodDays).
import { useState } from "react";
import {
  Alert,
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
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { productVariantsApi } from "./api";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { qty } from "../../shared/ui/format";

const PERIOD_OPTIONS = [
  { value: 7, label: "Últimos 7 dias" },
  { value: 30, label: "Últimos 30 dias" },
  { value: 90, label: "Últimos 90 dias" },
  { value: 365, label: "Últimos 365 dias" },
];

function formatTurnover(ratio: number | null): string {
  if (ratio === null) return "∞ (vendeu com estoque zerado)";
  return ratio.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function VariantTurnoverReportPage() {
  const [periodDays, setPeriodDays] = useState(30);
  const query = useQuery({
    queryKey: ["product-variants", "turnover-report", periodDays],
    queryFn: () => productVariantsApi.getTurnoverReport(periodDays),
  });

  return (
    <Page>
      <PageHeader
        title="Giro de estoque por grade/variante"
        subtitle="Capítulo 4.6 — Varejo Geral: quantidade vendida x estoque atual por variante (cor/tamanho), ordenado por mais vendidos (proxy de Curva ABC)."
      />
      <Stack spacing={2}>
        <TextField
          select
          label="Período"
          value={periodDays}
          onChange={(e) => setPeriodDays(Number(e.target.value))}
          sx={{ maxWidth: 240 }}
        >
          {PERIOD_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>

        <Alert severity="info">
          Giro = quantidade vendida no período ÷ estoque atual (proxy do estoque médio — o sistema não mantém saldo
          diário histórico por variante). Pesquisa de mercado (Sebrae): giro ideal gira de 8-12x/ano para itens de
          alta rotatividade e 2-4x/ano para bens duráveis/semiduráveis; use este relatório junto da Curva ABC (classes
          A/B/C completas ainda não implementadas nesta tela — ver pendências).
        </Alert>

        <QueryState query={query} isEmpty={(d) => d.variants.length === 0} emptyMessage="Nenhuma variante cadastrada.">
          {(report) => (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Produto</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell>Eixo</TableCell>
                    <TableCell>Variante</TableCell>
                    <TableCell align="right">Vendido no período</TableCell>
                    <TableCell align="right">Estoque atual</TableCell>
                    <TableCell align="right">Giro</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.variants.map((row) => (
                    <TableRow key={row.variantId} hover>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell>{row.sku}</TableCell>
                      <TableCell>{row.axis}</TableCell>
                      <TableCell>{row.axisValue}</TableCell>
                      <TableCell align="right">{qty(row.quantitySold)}</TableCell>
                      <TableCell align="right">{qty(row.currentStock)}</TableCell>
                      <TableCell align="right">
                        <Tooltip title="Vendido ÷ estoque atual (proxy de estoque médio)">
                          <span>{formatTurnover(row.turnoverRatio)}</span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </QueryState>
        <Typography variant="caption" color="text.secondary">
          Período consultado desde {query.data ? new Date(query.data.since).toLocaleString("pt-BR") : "—"}.
        </Typography>
      </Stack>
    </Page>
  );
}
