// apps/web/src/modules/multi-filial/MultiFilialDashboardPage.tsx
// Capítulo 1.2.5/2.3 — Dashboard consolidado para a matriz de uma rede multi-filial
// (`Tenant.parentTenantId`/`childTenants`): vendas de hoje/mês, caixas abertos e
// alertas de estoque baixo, somados pela rede inteira e detalhados por unidade.
import {
  Alert,
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { money } from "../../shared/ui/format";
import { ApiError } from "../../api/client";
import { multiFilialApi, type MultiFilialDashboard } from "./api";

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Paper sx={{ p: 2, flex: 1, minWidth: 180 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h5">{value}</Typography>
    </Paper>
  );
}

export function MultiFilialDashboardPage() {
  const query = useQuery({ queryKey: ["multi-filial", "dashboard"], queryFn: () => multiFilialApi.dashboard() });

  if (query.isError) {
    const err = query.error as ApiError;
    if (err.code === "NOT_MATRIZ") {
      return (
        <Page>
          <PageHeader title="Dashboard consolidado (Multi-Filial)" />
          <Alert severity="info">Esta unidade é uma filial. O dashboard consolidado é visível apenas pela matriz da rede.</Alert>
        </Page>
      );
    }
    if (err.code === "NO_BRANCHES") {
      return (
        <Page>
          <PageHeader title="Dashboard consolidado (Multi-Filial)" />
          <Alert severity="warning">Nenhuma filial vinculada a esta matriz ainda. Fale com o suporte Filitech para cadastrar as unidades da rede.</Alert>
        </Page>
      );
    }
  }

  return (
    <Page>
      <PageHeader
        title="Dashboard consolidado (Multi-Filial)"
        subtitle="Visão somada de todas as unidades da rede, sem misturar o isolamento transacional de cada filial — cada loja fecha seu próprio caixa, estoque e vendas normalmente."
      />
      <QueryState query={query}>
        {(data: MultiFilialDashboard) => (
          <Stack spacing={3}>
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <KpiCard label="Vendas hoje (rede)" value={`${money(data.totals.salesTodayTotal)} · ${data.totals.salesTodayCount} vendas`} />
              <KpiCard label="Vendas no mês (rede)" value={`${money(data.totals.salesMonthTotal)} · ${data.totals.salesMonthCount} vendas`} />
              <KpiCard label="Caixas abertos agora" value={String(data.totals.openCashRegisters)} />
              <KpiCard label="Produtos com estoque baixo" value={String(data.totals.lowStockProductsCount)} />
            </Stack>
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Unidade</TableCell>
                      <TableCell>UF</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Vendas hoje</TableCell>
                      <TableCell align="right">Vendas no mês</TableCell>
                      <TableCell align="right">Caixas abertos</TableCell>
                      <TableCell align="right">Estoque baixo</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.branches.map((b) => (
                      <TableRow key={b.tenantId} hover>
                        <TableCell>
                          {b.tradeName} {b.isMatriz && <Chip size="small" label="Matriz" sx={{ ml: 1 }} />}
                        </TableCell>
                        <TableCell>{b.uf ?? "—"}</TableCell>
                        <TableCell>{b.status}</TableCell>
                        <TableCell align="right">{money(b.salesToday.total)} ({b.salesToday.count})</TableCell>
                        <TableCell align="right">{money(b.salesMonth.total)} ({b.salesMonth.count})</TableCell>
                        <TableCell align="right">{b.openCashRegisters}</TableCell>
                        <TableCell align="right">{b.lowStockProductsCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Stack>
        )}
      </QueryState>
    </Page>
  );
}
