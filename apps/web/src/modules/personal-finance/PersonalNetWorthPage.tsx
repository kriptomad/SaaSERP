// apps/web/src/modules/personal-finance/PersonalNetWorthPage.tsx
// Capítulo 22.6 — patrimônio líquido consolidado (ativos - passivos), com
// histórico mensal de snapshots e recálculo manual sob demanda.
import { Button, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, money } from "../../shared/ui/format";
import { personalFinanceApi } from "./api";

export function PersonalNetWorthPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["personal-net-worth"], queryFn: () => personalFinanceApi.netWorthSnapshots() });

  const recompute = useMutation({
    mutationFn: () => personalFinanceApi.recomputeNetWorth(),
    onSuccess: () => {
      toast.success("Patrimônio líquido recalculado.");
      void queryClient.invalidateQueries({ queryKey: ["personal-net-worth"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const latest = query.data?.[query.data.length - 1];

  return (
    <Page>
      <PageHeader
        title="Patrimônio líquido"
        subtitle="Ativos (contas + investimentos) menos passivos (faturas de cartão + dívidas) — fotografia mensal."
        actions={
          <Button variant="contained" startIcon={<RefreshIcon />} onClick={() => recompute.mutate()} disabled={recompute.isPending}>
            {recompute.isPending ? "Recalculando…" : "Recalcular agora"}
          </Button>
        }
      />
      {latest && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={4}>
            <div>
              <Typography variant="caption" color="text.secondary">Patrimônio líquido atual</Typography>
              <Typography variant="h5">{money(latest.netWorth)}</Typography>
            </div>
            <div>
              <Typography variant="caption" color="text.secondary">Ativos totais</Typography>
              <Typography variant="h6">{money(latest.totalAssets)}</Typography>
            </div>
            <div>
              <Typography variant="caption" color="text.secondary">Passivos totais</Typography>
              <Typography variant="h6">{money(latest.totalLiabilities)}</Typography>
            </div>
          </Stack>
        </Paper>
      )}
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage='Nenhum histórico de patrimônio ainda — clique em "Recalcular agora".'>
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Mês</TableCell>
                  <TableCell align="right">Ativos</TableCell>
                  <TableCell align="right">Passivos</TableCell>
                  <TableCell align="right">Patrimônio líquido</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...rows].reverse().map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell>{formatDate(s.snapshotDate)}</TableCell>
                    <TableCell align="right">{money(s.totalAssets)}</TableCell>
                    <TableCell align="right">{money(s.totalLiabilities)}</TableCell>
                    <TableCell align="right">{money(s.netWorth)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
    </Page>
  );
}
