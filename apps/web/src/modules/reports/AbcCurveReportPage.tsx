// apps/web/src/modules/reports/AbcCurveReportPage.tsx
// Fonte: pesquisa de mercado (varejo de conveniência Brasil) — Curva ABC de produtos
// por participação acumulada no faturamento, régua gerencial crítica não coberta
// literalmente pelo Bible mas citada pelo Capítulo 4.1/18 como evolução natural da
// luta contra ruptura de estoque. Consome GET /reports/abc-curve.
//
// Capítulo 11.4 — Loja de Roupas/Moda: "Curva ABC calculada por COMBINAÇÃO
// cor/tamanho (variante), não por produto agregado." O toggle "Por variante" troca
// para GET /reports/abc-curve-variants (abc-curve-report.service.ts,
// buildVariantAbcCurveReport) sem duplicar a tela inteira — só a fonte de dados e
// as colunas de identificação da linha mudam (variante em vez de categoria).
import { useState } from "react";
import {
  Alert,
  Chip,
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
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, ABC_CLASS_COLOR, ABC_CLASS_LABEL } from "./api";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { money, toNumber } from "../../shared/ui/format";

const PERIOD_OPTIONS = [
  { value: 30, label: "Últimos 30 dias" },
  { value: 60, label: "Últimos 60 dias" },
  { value: 90, label: "Últimos 90 dias" },
];

export function AbcCurveReportPage() {
  const [days, setDays] = useState(30);
  const [granularity, setGranularity] = useState<"product" | "variant">("product");
  const productQuery = useQuery({
    queryKey: ["reports", "abc-curve", days],
    queryFn: () => reportsApi.abcCurve(days),
    enabled: granularity === "product",
  });
  const variantQuery = useQuery({
    queryKey: ["reports", "abc-curve-variants", days],
    queryFn: () => reportsApi.abcCurveVariants(days),
    enabled: granularity === "variant",
  });

  return (
    <Page maxWidth={1100}>
      <PageHeader
        title="Curva ABC de Produtos"
        subtitle="Ranqueia produtos (ou variantes) pela participação acumulada no faturamento: Classe A sustenta a maior parte das vendas e deve ter prioridade absoluta na reposição."
        actions={
          <Stack direction="row" spacing={1}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={granularity}
              onChange={(_, value) => value && setGranularity(value)}
            >
              <ToggleButton value="product">Por produto</ToggleButton>
              <ToggleButton value="variant">Por variante (cor/tamanho)</ToggleButton>
            </ToggleButtonGroup>
            <TextField select size="small" label="Período" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ minWidth: 180 }}>
              {PERIOD_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        }
      />
      {granularity === "product" ? (
        <QueryState query={productQuery} isEmpty={(rows) => rows.length === 0}>
          {(rows) => (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Produto</TableCell>
                    <TableCell>Categoria</TableCell>
                    <TableCell align="right">Qtd. vendida</TableCell>
                    <TableCell align="right">Faturamento</TableCell>
                    <TableCell align="right">% do total</TableCell>
                    <TableCell align="right">% acumulado</TableCell>
                    <TableCell>Classe</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.productId}>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell>{row.category ?? "—"}</TableCell>
                      <TableCell align="right">{toNumber(row.quantitySold).toLocaleString("pt-BR")}</TableCell>
                      <TableCell align="right">{money(row.revenue)}</TableCell>
                      <TableCell align="right">{(row.revenueShare * 100).toFixed(1)}%</TableCell>
                      <TableCell align="right">{(row.cumulativeShare * 100).toFixed(1)}%</TableCell>
                      <TableCell>
                        <Chip size="small" color={ABC_CLASS_COLOR[row.abcClass]} label={row.abcClass} title={ABC_CLASS_LABEL[row.abcClass]} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </QueryState>
      ) : (
        <QueryState query={variantQuery} isEmpty={(rows) => rows.length === 0} emptyMessage="Nenhuma variante vendida no período.">
          {(rows) => (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Produto</TableCell>
                    <TableCell>Eixo</TableCell>
                    <TableCell>Variante</TableCell>
                    <TableCell align="right">Qtd. vendida</TableCell>
                    <TableCell align="right">Faturamento</TableCell>
                    <TableCell align="right">% do total</TableCell>
                    <TableCell align="right">% acumulado</TableCell>
                    <TableCell>Classe</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.variantId}>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell>{row.axis}</TableCell>
                      <TableCell>{row.axisValue}</TableCell>
                      <TableCell align="right">{toNumber(row.quantitySold).toLocaleString("pt-BR")}</TableCell>
                      <TableCell align="right">{money(row.revenue)}</TableCell>
                      <TableCell align="right">{(row.revenueShare * 100).toFixed(1)}%</TableCell>
                      <TableCell align="right">{(row.cumulativeShare * 100).toFixed(1)}%</TableCell>
                      <TableCell>
                        <Chip size="small" color={ABC_CLASS_COLOR[row.abcClass]} label={row.abcClass} title={ABC_CLASS_LABEL[row.abcClass]} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </QueryState>
      )}
      <Alert severity="info" sx={{ mt: 2 }}>
        Classe A (até 80% do faturamento acumulado): priorize reposição e exposição. Classe C (cauda longa): mantenha o
        sortimento, mas sem engessar capital de giro em excesso.
      </Alert>
    </Page>
  );
}

