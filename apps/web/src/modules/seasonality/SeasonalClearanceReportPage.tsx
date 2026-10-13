// apps/web/src/modules/seasonality/SeasonalClearanceReportPage.tsx
// Capítulo 11.5 — Papelaria/Presentes: "Financeiro pós-sazonalidade" — sobras de
// estoque sazonal após o pico, sinalizadas automaticamente para liquidação (evita
// capital parado). Ver heurística documentada em seasonality.routes.ts.
import { Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { seasonalityApi } from "./api";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { formatDateTime } from "../../shared/ui/format";

export function SeasonalClearanceReportPage() {
  const query = useQuery({ queryKey: ["seasonality-clearance-report"], queryFn: seasonalityApi.clearanceReport });

  return (
    <Page>
      <PageHeader
        title="Liquidação de Sobras Sazonais"
        subtitle="Produtos com estoque acima do esperado cuja janela de sazonalidade já encerrou — candidatos a liquidação para evitar capital parado."
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma sobra sazonal identificada no momento.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Produto</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell>Categoria</TableCell>
                    <TableCell align="right">Estoque atual</TableCell>
                    <TableCell align="right">Limite mínimo</TableCell>
                    <TableCell>Janela</TableCell>
                    <TableCell>Encerrou em</TableCell>
                    <TableCell>Cadastrado em</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.productId} hover>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell>{row.sku}</TableCell>
                      <TableCell>
                        <Chip size="small" label={row.category} />
                      </TableCell>
                      <TableCell align="right">{row.stockQuantity}</TableCell>
                      <TableCell align="right">{row.minStockThreshold ?? "—"}</TableCell>
                      <TableCell>{row.seasonalityWindowName}</TableCell>
                      <TableCell>{formatDateTime(row.windowEndedAt)}</TableCell>
                      <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
    </Page>
  );
}
