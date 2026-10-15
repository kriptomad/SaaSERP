// apps/web/src/modules/personal-finance/PersonalBudgetPage.tsx
// Capítulo 22.4 — orçamento mensal por categoria. O backend expõe POST como upsert
// (chave única tenantId+categoryId+monthReference) — "criar" e "editar" usam o
// mesmo endpoint.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { money, parseDecimal } from "../../shared/ui/format";
import { personalFinanceApi, type PersonalBudget } from "./api";

function currentMonthInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthInputToIso(value: string): string {
  return `${value}-01T12:00:00.000Z`;
}

function BudgetDialog({ budget, monthReference, onClose }: { budget: PersonalBudget | null; monthReference: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const categoriesQuery = useQuery({ queryKey: ["personal-categories"], queryFn: () => personalFinanceApi.categories() });
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? "");
  const [limitAmount, setLimitAmount] = useState(budget ? String(Number(budget.limitAmount)) : "");
  const [rolloverEnabled, setRolloverEnabled] = useState(budget?.rolloverEnabled ?? false);
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => personalFinanceApi.createBudget(body),
    onSuccess: () => {
      toast.success("Orçamento salvo.");
      void queryClient.invalidateQueries({ queryKey: ["personal-budgets"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const expenseCategories = (categoriesQuery.data ?? []).filter((c) => c.type === "EXPENSE");

  function submit() {
    setFormError(null);
    if (!categoryId) return setFormError("Selecione a categoria.");
    const limit = parseDecimal(limitAmount);
    if (limit === null || limit <= 0) return setFormError("Informe um limite maior que zero.");
    mutation.mutate({ categoryId, monthReference: monthInputToIso(monthReference), limitAmount: limit, rolloverEnabled });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{budget ? "Editar orçamento" : "Novo orçamento"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField select label="Categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required disabled={Boolean(budget)}>
            {expenseCategories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Limite mensal (R$)" value={limitAmount} onChange={(e) => setLimitAmount(e.target.value)} required />
          <FormControlLabel
            control={<Switch checked={rolloverEnabled} onChange={(e) => setRolloverEnabled(e.target.checked)} />}
            label="Saldo não gasto soma ao limite do mês seguinte"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function PersonalBudgetPage() {
  const [monthReference, setMonthReference] = useState(currentMonthInput());
  const [editing, setEditing] = useState<PersonalBudget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const query = useQuery({
    queryKey: ["personal-budgets", monthReference],
    queryFn: () => personalFinanceApi.budgets(monthInputToIso(monthReference)),
  });

  return (
    <Page>
      <PageHeader
        title="Orçamento mensal"
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Novo orçamento
          </Button>
        }
      />
      <TextField
        label="Mês de referência"
        type="month"
        value={monthReference}
        onChange={(e) => setMonthReference(e.target.value)}
        InputLabelProps={{ shrink: true }}
        sx={{ mb: 3, minWidth: 200 }}
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum orçamento definido para este mês.">
        {(rows) => (
          <Stack spacing={2}>
            {rows.map((b) => {
              const pct = Math.min(100, b.percentageUsed);
              const over = b.percentageUsed > 100;
              return (
                <Paper key={b.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="subtitle1">{b.category?.name ?? "—"}</Typography>
                    <Button
                      size="small"
                      onClick={() => {
                        setEditing(b);
                        setDialogOpen(true);
                      }}
                    >
                      Editar
                    </Button>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {money(b.spentAmount)} de {money(b.limitAmount)} ({b.percentageUsed.toFixed(0)}%)
                    {b.rolloverEnabled && " · rollover ativado"}
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <LinearProgress variant="determinate" value={pct} color={over ? "error" : pct > 85 ? "warning" : "success"} />
                  </Box>
                </Paper>
              );
            })}
          </Stack>
        )}
      </QueryState>
      {dialogOpen && <BudgetDialog key={editing?.id ?? "new"} budget={editing} monthReference={monthReference} onClose={() => setDialogOpen(false)} />}
    </Page>
  );
}
