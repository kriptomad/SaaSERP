// apps/web/src/modules/financial/FinancialDashboardPage.tsx
// Fluxo de caixa projetado (/reports/cash-flow-projection) e DRE (/reports/dre) da API real.
import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  LinearProgress,
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
import { Link as RouterLink } from "react-router-dom";
import { api } from "../../api/client";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { formatDate, money, toDateInput, toNumber } from "../../shared/ui/format";

interface CashFlow {
  realizedInflow: string;
  realizedOutflow: string;
  projectedByDay: Array<{ day: string; inflow: string; outflow: string }>;
}

interface DreLine {
  chartOfAccountId: string | null;
  accountName: string;
  amount: string;
}

interface Dre {
  grossRevenue: string;
  totalExpenses: string;
  netResult: string;
  revenueLines: DreLine[];
  expenseLines: DreLine[];
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 180 }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h6" sx={{ color }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

function CashFlowSection() {
  const [daysAhead, setDaysAhead] = useState(30);
  const query = useQuery({
    queryKey: ["cash-flow", daysAhead],
    queryFn: () => api.get<CashFlow>("/reports/cash-flow-projection", { daysAhead }),
  });

  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">Fluxo de caixa</Typography>
        <TextField select size="small" label="Horizonte" value={daysAhead} onChange={(e) => setDaysAhead(Number(e.target.value))} sx={{ minWidth: 140 }}>
          {[7, 15, 30, 60, 90].map((d) => (
            <MenuItem key={d} value={d}>
              {d} dias
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <QueryState query={query}>
        {(flow) => {
          const days = flow.projectedByDay ?? [];
          const totalIn = days.reduce((s, d) => s + toNumber(d.inflow), 0);
          const totalOut = days.reduce((s, d) => s + toNumber(d.outflow), 0);
          const peak = Math.max(1, ...days.map((d) => Math.max(toNumber(d.inflow), toNumber(d.outflow))));
          let running = 0;
          const rows = days.map((d) => {
            running += toNumber(d.inflow) - toNumber(d.outflow);
            return { ...d, running };
          });
          const activeRows = rows.filter((r) => toNumber(r.inflow) > 0 || toNumber(r.outflow) > 0);
          return (
            <>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 2 }}>
                <StatCard label="Entradas realizadas (vendas pagas)" value={money(flow.realizedInflow)} color="success.main" />
                <StatCard label="Saídas realizadas (contas pagas)" value={money(flow.realizedOutflow)} color="error.main" />
                <StatCard label={`A receber em ${daysAhead} dias`} value={money(totalIn)} />
                <StatCard label={`A pagar em ${daysAhead} dias`} value={money(totalOut)} />
                <StatCard label="Saldo projetado" value={money(totalIn - totalOut)} color={totalIn - totalOut < 0 ? "error.main" : "success.main"} />
              </Stack>
              {activeRows.length === 0 ? (
                <Alert severity="info">Nenhuma conta a pagar ou a receber pendente no período.</Alert>
              ) : (
                <TableContainer component={Paper}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Dia</TableCell>
                        <TableCell align="right">Entradas</TableCell>
                        <TableCell align="right">Saídas</TableCell>
                        <TableCell align="right">Acumulado</TableCell>
                        <TableCell sx={{ width: "25%" }}>Volume</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {activeRows.map((r) => (
                        <TableRow key={r.day}>
                          <TableCell>{formatDate(r.day)}</TableCell>
                          <TableCell align="right">{money(r.inflow)}</TableCell>
                          <TableCell align="right">{money(r.outflow)}</TableCell>
                          <TableCell align="right" sx={{ color: r.running < 0 ? "error.main" : undefined }}>
                            {money(r.running)}
                          </TableCell>
                          <TableCell>
                            <LinearProgress variant="determinate" color="success" value={(toNumber(r.inflow) / peak) * 100} sx={{ mb: 0.5 }} />
                            <LinearProgress variant="determinate" color="error" value={(toNumber(r.outflow) / peak) * 100} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          );
        }}
      </QueryState>
    </Box>
  );
}

function DreSection() {
  const now = new Date();
  const [start, setStart] = useState(toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [end, setEnd] = useState(toDateInput(now));
  const period = useMemo(
    () => ({ periodStart: new Date(`${start}T00:00:00`).toISOString(), periodEnd: new Date(`${end}T23:59:59`).toISOString() }),
    [start, end],
  );
  const valid = Boolean(start) && Boolean(end) && start <= end;
  const query = useQuery({ queryKey: ["dre", period], queryFn: () => api.get<Dre>("/reports/dre", period), enabled: valid });

  return (
    <Box>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1} sx={{ mb: 1 }}>
        <Typography variant="h6">DRE — resultado do período</Typography>
        <Stack direction="row" spacing={1}>
          <TextField size="small" type="date" label="De" value={start} onChange={(e) => setStart(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label="Até" value={end} onChange={(e) => setEnd(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Stack>
      </Stack>
      {!valid && <Alert severity="warning">Período inválido: a data inicial deve ser anterior à final.</Alert>}
      {valid && (
        <QueryState query={query}>
          {(dre) => (
            <>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 2 }}>
                <StatCard label="Receita bruta" value={money(dre.grossRevenue)} color="success.main" />
                <StatCard label="Despesas pagas" value={money(dre.totalExpenses)} color="error.main" />
                <StatCard label="Resultado líquido" value={money(dre.netResult)} color={toNumber(dre.netResult) < 0 ? "error.main" : "success.main"} />
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <DreTable title="Receitas por conta" lines={dre.revenueLines} />
                <DreTable title="Despesas por conta" lines={dre.expenseLines} />
              </Stack>
            </>
          )}
        </QueryState>
      )}
    </Box>
  );
}

function DreTable({ title, lines }: { title: string; lines: DreLine[] }) {
  return (
    <TableContainer component={Paper} sx={{ flex: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell colSpan={2}>{title}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2}>
                <Typography variant="body2" color="text.secondary">
                  Sem lançamentos no período.
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            lines.map((l) => (
              <TableRow key={l.chartOfAccountId ?? "none"}>
                <TableCell>{l.accountName}</TableCell>
                <TableCell align="right">{money(l.amount)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function FinancialDashboardPage() {
  return (
    <Page>
      <PageHeader
        title="Financeiro"
        subtitle="Fluxo de caixa e resultado calculados pela API a partir de vendas e contas."
        actions={
          <>
            <Button component={RouterLink} to="/financeiro/pagar" variant="outlined">
              Contas a pagar
            </Button>
            <Button component={RouterLink} to="/financeiro/receber" variant="outlined">
              Contas a receber
            </Button>
          </>
        }
      />
      <CashFlowSection />
      <DreSection />
    </Page>
  );
}
