// apps/web/src/modules/personal-finance/PersonalDashboardPage.tsx
// Capítulo 22.1 — visão consolidada do Filitech Pessoal: saldo total, receitas x
// despesas do mês, progresso de orçamentos, contas a vencer, metas ativas e
// evolução patrimonial. Sem biblioteca de gráficos instalada no projeto (ver
// apps/web/package.json) — evolução patrimonial exibida em tabela, conforme
// orientação da tarefa de não adicionar nova dependência.
import { Alert, Box, Chip, Grid, LinearProgress, Link as MuiLink, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { Page, PageHeader } from "../../shared/ui/PageLayout";
import { formatDate, money, toNumber } from "../../shared/ui/format";
import { BILL_STATUS_LABEL, GOAL_TYPE_LABEL, personalFinanceApi } from "./api";

function currentMonthReference(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function PersonalDashboardPage() {
  const accountsQuery = useQuery({ queryKey: ["personal-accounts"], queryFn: () => personalFinanceApi.accounts() });
  const monthReference = currentMonthReference();
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const transactionsQuery = useQuery({
    queryKey: ["personal-transactions", "dashboard", monthReference],
    queryFn: () => personalFinanceApi.transactions({ from: firstDayOfMonth }),
  });
  const budgetsQuery = useQuery({ queryKey: ["personal-budgets", monthReference], queryFn: () => personalFinanceApi.budgets(monthReference) });
  const billsQuery = useQuery({ queryKey: ["personal-bills"], queryFn: () => personalFinanceApi.bills() });
  const goalsQuery = useQuery({ queryKey: ["personal-goals"], queryFn: () => personalFinanceApi.goals() });
  const netWorthQuery = useQuery({ queryKey: ["personal-net-worth"], queryFn: () => personalFinanceApi.netWorthSnapshots() });

  const loading = accountsQuery.isLoading || transactionsQuery.isLoading;

  const totalBalance = (accountsQuery.data ?? [])
    .filter((a) => !a.archivedAt && a.type !== "CREDIT_CARD")
    .reduce((sum, a) => sum + toNumber(a.currentBalance), 0);

  const monthIncome = (transactionsQuery.data ?? [])
    .filter((t) => t.type === "INCOME")
    .reduce((sum, t) => sum + toNumber(t.amount), 0);
  const monthExpense = (transactionsQuery.data ?? [])
    .filter((t) => t.type === "EXPENSE")
    .reduce((sum, t) => sum + toNumber(t.amount), 0);

  const today = new Date();
  const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingBills = (billsQuery.data ?? [])
    .filter((b) => b.status !== "PAID")
    .filter((b) => {
      const dueThisMonth = new Date(today.getFullYear(), today.getMonth(), b.dueDay);
      const dueNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, b.dueDay);
      return (dueThisMonth >= today && dueThisMonth <= sevenDaysFromNow) || (dueNextMonth >= today && dueNextMonth <= sevenDaysFromNow);
    })
    .sort((a, b) => a.dueDay - b.dueDay);

  const activeGoals = (goalsQuery.data ?? []).filter((g) => g.status === "ACTIVE");
  const netWorthHistory = netWorthQuery.data ?? [];
  const latestNetWorth = netWorthHistory[netWorthHistory.length - 1];

  return (
    <Page>
      <PageHeader title="Painel pessoal" subtitle="Resumo das suas finanças domésticas neste mês." />

      {loading && <LinearProgress sx={{ mb: 3 }} />}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">Saldo total em contas</Typography>
            <Typography variant="h5">{money(totalBalance)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">Receitas no mês</Typography>
            <Typography variant="h5" color="success.main">{money(monthIncome)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">Despesas no mês</Typography>
            <Typography variant="h5" color="error.main">{money(monthExpense)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">Patrimônio líquido</Typography>
            <Typography variant="h5">{latestNetWorth ? money(latestNetWorth.netWorth) : "—"}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Orçamento do mês</Typography>
            {(budgetsQuery.data ?? []).length === 0 ? (
              <Typography color="text.secondary">
                Nenhum orçamento definido para este mês. <MuiLink component={RouterLink} to="/pessoal/orcamento">Criar orçamento</MuiLink>
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {(budgetsQuery.data ?? []).map((b) => (
                  <Box key={b.id}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2">{b.category?.name ?? "Categoria"}</Typography>
                      <Typography variant="body2">
                        {money(b.spentAmount)} / {money(b.limitAmount)}
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, b.percentageUsed)}
                      color={b.percentageUsed >= 100 ? "error" : b.percentageUsed >= 80 ? "warning" : "primary"}
                    />
                  </Box>
                ))}
              </Stack>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Metas ativas</Typography>
            {activeGoals.length === 0 ? (
              <Typography color="text.secondary">
                Nenhuma meta ativa. <MuiLink component={RouterLink} to="/pessoal/metas">Criar meta</MuiLink>
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {activeGoals.map((g) => {
                  const pct = toNumber(g.targetAmount) > 0 ? Math.min(100, (toNumber(g.currentAmount) / toNumber(g.targetAmount)) * 100) : 0;
                  return (
                    <Box key={g.id}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2">
                          {g.name} <Chip size="small" label={GOAL_TYPE_LABEL[g.type]} sx={{ ml: 1 }} />
                        </Typography>
                        <Typography variant="body2">
                          {money(g.currentAmount)} / {money(g.targetAmount)}
                        </Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={pct} />
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Contas a vencer (próximos 7 dias)</Typography>
            {upcomingBills.length === 0 ? (
              <Typography color="text.secondary">Nenhuma conta a vencer nos próximos 7 dias.</Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Nome</TableCell>
                      <TableCell>Dia</TableCell>
                      <TableCell align="right">Valor</TableCell>
                      <TableCell>Situação</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {upcomingBills.map((b) => (
                      <TableRow key={b.id} hover>
                        <TableCell>{b.name}</TableCell>
                        <TableCell>Dia {b.dueDay}</TableCell>
                        <TableCell align="right">{money(b.amount)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={BILL_STATUS_LABEL[b.status]} color={b.status === "OVERDUE" ? "error" : "warning"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <MuiLink component={RouterLink} to="/pessoal/contas" sx={{ display: "inline-block", mt: 1 }}>
              Ver todas as contas a pagar
            </MuiLink>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Evolução patrimonial</Typography>
            {netWorthHistory.length === 0 ? (
              <Alert severity="info">
                Nenhum histórico ainda. <MuiLink component={RouterLink} to="/pessoal/patrimonio">Recalcular patrimônio</MuiLink>
              </Alert>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Mês</TableCell>
                      <TableCell align="right">Patrimônio líquido</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...netWorthHistory].reverse().slice(0, 6).map((s) => (
                      <TableRow key={s.id} hover>
                        <TableCell>{formatDate(s.snapshotDate)}</TableCell>
                        <TableCell align="right">{money(s.netWorth)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <MuiLink component={RouterLink} to="/pessoal/patrimonio" sx={{ display: "inline-block", mt: 1 }}>
              Ver histórico completo
            </MuiLink>
          </Paper>
        </Grid>
      </Grid>
    </Page>
  );
}
