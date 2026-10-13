// apps/web/src/modules/reports/CollectionTurnoverReportPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.4 (Loja de Roupas/Moda) — "relatório de
// giro por coleção + sinalização automática de liquidação para referências de baixo
// giro antes da troca de estação." Consome GET /reports/collection-turnover.
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
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { reportsApi } from "./api";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { money, qty } from "../../shared/ui/format";

const PERIOD_OPTIONS = [
  { value: 30, label: "Últimos 30 dias" },
  { value: 90, label: "Últimos 90 dias" },
  { value: 180, label: "Últimos 180 dias" },
];

export function CollectionTurnoverReportPage() {
  const [days, setDays] = useState(90);
  const query = useQuery({ queryKey: ["reports", "collection-turnover", days], queryFn: () => reportsApi.collectionTurnover(days) });

  return (
    <Page maxWidth={1100}>
      <PageHeader
        title="Giro por coleção/estação"
        subtitle="Capítulo 11.4 — Loja de Roupas/Moda: giro de vendas agrupado pela tag de coleção/estação do produto, com sinalização automática de candidatos a liquidação antes da troca de estação."
        actions={
          <TextField select size="small" label="Período" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ minWidth: 180 }}>
            {PERIOD_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      <QueryState query={query} isEmpty={(r) => r.collections.length === 0} emptyMessage="Nenhum produto com coleção/estação cadastrada.">
        {(report) => (
          <Stack spacing={3}>
            <Typography variant="h6">Resumo por coleção</Typography>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Coleção/estação</TableCell>
                    <TableCell align="right">Produtos</TableCell>
                    <TableCell align="right">Qtd. vendida</TableCell>
                    <TableCell align="right">Faturamento</TableCell>
                    <TableCell align="right">Média/produto</TableCell>
                    <TableCell align="right">Candidatos a liquidação</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.collections.map((row) => (
                    <TableRow key={row.collectionTag} hover>
                      <TableCell>{row.collectionTag}</TableCell>
                      <TableCell align="right">{row.productCount}</TableCell>
                      <TableCell align="right">{qty(row.totalQuantitySold)}</TableCell>
                      <TableCell align="right">{money(row.totalRevenue)}</TableCell>
                      <TableCell align="right">{row.avgQuantitySoldPerProduct.toFixed(1)}</TableCell>
                      <TableCell align="right">
                        {row.clearanceCandidateCount > 0 ? (
                          <Chip size="small" color="warning" label={row.clearanceCandidateCount} />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Typography variant="h6">Candidatos a liquidação</Typography>
            <Alert severity="warning">
              Vendeu menos de 40% da média de giro da própria coleção e ainda tem estoque — considere liquidar antes da
              troca de estação.
            </Alert>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Produto</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell>Coleção/estação</TableCell>
                    <TableCell align="right">Vendido</TableCell>
                    <TableCell align="right">Estoque atual</TableCell>
                    <TableCell>Liquidação?</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.products
                    .filter((p) => p.isClearanceCandidate)
                    .map((row) => (
                      <TableRow key={row.productId} hover>
                        <TableCell>{row.productName}</TableCell>
                        <TableCell>{row.sku}</TableCell>
                        <TableCell>{row.collectionTag}</TableCell>
                        <TableCell align="right">{qty(row.quantitySold)}</TableCell>
                        <TableCell align="right">{qty(row.currentStock)}</TableCell>
                        <TableCell>
                          <Chip size="small" color="warning" label="Sugerido" />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        )}
      </QueryState>
    </Page>
  );
}
