// apps/web/src/modules/personal-finance/PersonalGoalsPage.tsx
// Capítulo 22.4 — metas financeiras da residência (poupança, quitação de dívida,
// reserva de emergência, compra planejada).
import { useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, LinearProgress, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, money, parseDecimal, toDateInput, dateInputToIso } from "../../shared/ui/format";
import { GOAL_STATUS_LABEL, GOAL_TYPE_LABEL, personalFinanceApi, type PersonalAccount, type PersonalGoal, type PersonalGoalType } from "./api";

function GoalDialog({ accounts, onClose }: { accounts: PersonalAccount[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<PersonalGoalType>("SAVINGS");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => personalFinanceApi.createGoal(body),
    onSuccess: () => {
      toast.success("Meta criada.");
      void queryClient.invalidateQueries({ queryKey: ["personal-goals"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!name.trim()) return setFormError("Informe o nome da meta.");
    const target = parseDecimal(targetAmount);
    if (target === null || target <= 0) return setFormError("Informe um valor-alvo maior que zero.");
    mutation.mutate({
      name: name.trim(),
      type,
      targetAmount: target,
      targetDate: targetDate ? dateInputToIso(targetDate) : undefined,
      linkedAccountId: linkedAccountId || undefined,
    });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova meta</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField select label="Tipo" value={type} onChange={(e) => setType(e.target.value as PersonalGoalType)}>
            {(Object.keys(GOAL_TYPE_LABEL) as PersonalGoalType[]).map((t) => (
              <MenuItem key={t} value={t}>
                {GOAL_TYPE_LABEL[t]}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Valor-alvo (R$)" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} required fullWidth />
            <TextField
              label="Data-alvo (opcional)"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>
          <TextField select label="Conta vinculada (opcional)" value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)}>
            <MenuItem value="">Nenhuma</MenuItem>
            {accounts.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>
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

function UpdateProgressDialog({ goal, onClose }: { goal: PersonalGoal; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [currentAmount, setCurrentAmount] = useState(String(Number(goal.currentAmount)));
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => personalFinanceApi.updateGoal(goal.id, body),
    onSuccess: () => {
      toast.success("Progresso atualizado.");
      void queryClient.invalidateQueries({ queryKey: ["personal-goals"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    const value = parseDecimal(currentAmount);
    if (value === null || value < 0) return setFormError("Informe um valor válido.");
    mutation.mutate({ currentAmount: value });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Atualizar progresso — {goal.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Valor acumulado (R$)" value={currentAmount} onChange={(e) => setCurrentAmount(e.target.value)} autoFocus />
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

export function PersonalGoalsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["personal-goals"], queryFn: () => personalFinanceApi.goals() });
  const accountsQuery = useQuery({ queryKey: ["personal-accounts"], queryFn: () => personalFinanceApi.accounts() });
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<PersonalGoal | null>(null);

  const complete = useMutation({
    mutationFn: (goal: PersonalGoal) => personalFinanceApi.updateGoal(goal.id, { status: "COMPLETED" }),
    onSuccess: () => {
      toast.success("Meta marcada como concluída.");
      void queryClient.invalidateQueries({ queryKey: ["personal-goals"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Page>
      <PageHeader title="Metas financeiras" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Nova meta</Button>} />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma meta cadastrada ainda.">
        {(rows) => (
          <Grid container spacing={2}>
            {rows.map((g) => {
              const pct = Math.min(100, (Number(g.currentAmount) / Number(g.targetAmount)) * 100 || 0);
              return (
                <Grid item xs={12} sm={6} md={4} key={g.id}>
                  <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Typography variant="subtitle1">{g.name}</Typography>
                      <Chip
                        size="small"
                        label={GOAL_STATUS_LABEL[g.status]}
                        color={g.status === "COMPLETED" ? "success" : g.status === "ABANDONED" ? "default" : "primary"}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {GOAL_TYPE_LABEL[g.type]}
                      {g.targetDate && ` · alvo: ${formatDate(g.targetDate)}`}
                    </Typography>
                    <Box sx={{ mt: 2 }}>
                      <LinearProgress variant="determinate" value={pct} />
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {money(g.currentAmount)} de {money(g.targetAmount)} ({pct.toFixed(0)}%)
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                      <Button size="small" onClick={() => setUpdating(g)} disabled={g.status !== "ACTIVE"}>
                        Atualizar progresso
                      </Button>
                      {g.status === "ACTIVE" && (
                        <Button size="small" startIcon={<CheckCircleIcon />} onClick={() => complete.mutate(g)} disabled={complete.isPending}>
                          Concluir
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        )}
      </QueryState>
      {creating && <GoalDialog accounts={accountsQuery.data ?? []} onClose={() => setCreating(false)} />}
      {updating && <UpdateProgressDialog goal={updating} onClose={() => setUpdating(null)} />}
    </Page>
  );
}
