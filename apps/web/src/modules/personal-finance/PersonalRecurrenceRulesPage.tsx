// apps/web/src/modules/personal-finance/PersonalRecurrenceRulesPage.tsx
// Capítulo 22.4 — motor de recorrência (salário, aluguel, assinaturas). A geração
// automática roda via personal-recurrence-generation.worker.ts; esta tela só
// gerencia as regras (ativar/desativar, criar).
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { dateInputToIso, formatDate, money, parseDecimal, toDateInput } from "../../shared/ui/format";
import { RECURRENCE_FREQUENCY_LABEL, personalFinanceApi, type PersonalRecurrenceFrequency, type PersonalRecurrenceRule } from "./api";

function CreateRuleDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const accountsQuery = useQuery({ queryKey: ["personal-accounts"], queryFn: () => personalFinanceApi.accounts() });
  const categoriesQuery = useQuery({ queryKey: ["personal-categories"], queryFn: () => personalFinanceApi.categories() });
  const [frequency, setFrequency] = useState<PersonalRecurrenceFrequency>("MONTHLY");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateAmount, setTemplateAmount] = useState("");
  const [templateAccountId, setTemplateAccountId] = useState("");
  const [templateCategoryId, setTemplateCategoryId] = useState("");
  const [nextOccurrenceAt, setNextOccurrenceAt] = useState(toDateInput(new Date()));
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => personalFinanceApi.createRecurrenceRule(body),
    onSuccess: () => {
      toast.success("Regra de recorrência criada.");
      void queryClient.invalidateQueries({ queryKey: ["personal-recurrence-rules"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!templateDescription.trim()) return setFormError("Informe a descrição.");
    const value = parseDecimal(templateAmount);
    if (value === null || value <= 0) return setFormError("Informe um valor maior que zero.");
    if (!templateAccountId) return setFormError("Selecione a conta.");
    if (!nextOccurrenceAt) return setFormError("Informe a próxima ocorrência.");
    mutation.mutate({
      frequency,
      dayOfMonth: frequency !== "WEEKLY" ? Number(dayOfMonth) : undefined,
      templateDescription: templateDescription.trim(),
      templateAmount: value,
      templateAccountId,
      templateCategoryId: templateCategoryId || undefined,
      nextOccurrenceAt: dateInputToIso(nextOccurrenceAt),
    });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova regra de recorrência</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Descrição (ex.: Salário, Aluguel, Netflix)" value={templateDescription} onChange={(e) => setTemplateDescription(e.target.value)} required autoFocus />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select label="Frequência" value={frequency} onChange={(e) => setFrequency(e.target.value as PersonalRecurrenceFrequency)} fullWidth>
              {(Object.keys(RECURRENCE_FREQUENCY_LABEL) as PersonalRecurrenceFrequency[]).map((f) => (
                <MenuItem key={f} value={f}>
                  {RECURRENCE_FREQUENCY_LABEL[f]}
                </MenuItem>
              ))}
            </TextField>
            {frequency !== "WEEKLY" && (
              <TextField label="Dia do mês" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} fullWidth />
            )}
          </Stack>
          <TextField select label="Conta" value={templateAccountId} onChange={(e) => setTemplateAccountId(e.target.value)} required>
            {(accountsQuery.data ?? []).map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Categoria (opcional — define receita/despesa)" value={templateCategoryId} onChange={(e) => setTemplateCategoryId(e.target.value)}>
            <MenuItem value="">Sem categoria (assume despesa)</MenuItem>
            {(categoriesQuery.data ?? []).map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name} ({c.type === "INCOME" ? "receita" : "despesa"})
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Valor (R$)" value={templateAmount} onChange={(e) => setTemplateAmount(e.target.value)} required fullWidth />
            <TextField
              label="Próxima ocorrência"
              type="date"
              value={nextOccurrenceAt}
              onChange={(e) => setNextOccurrenceAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
              required
              fullWidth
            />
          </Stack>
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

export function PersonalRecurrenceRulesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["personal-recurrence-rules"], queryFn: () => personalFinanceApi.recurrenceRules() });
  const [creating, setCreating] = useState(false);

  const toggle = useMutation({
    mutationFn: (rule: PersonalRecurrenceRule) => personalFinanceApi.updateRecurrenceRule(rule.id, { active: !rule.active }),
    onSuccess: (rule) => {
      toast.success(rule.active ? "Regra reativada." : "Regra desativada.");
      void queryClient.invalidateQueries({ queryKey: ["personal-recurrence-rules"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Page>
      <PageHeader
        title="Lançamentos recorrentes"
        subtitle="Salário, aluguel e assinaturas são lançados automaticamente todo ciclo pela varredura diária do sistema."
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Nova regra</Button>}
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma regra de recorrência cadastrada.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Descrição</TableCell>
                  <TableCell>Frequência</TableCell>
                  <TableCell align="right">Valor</TableCell>
                  <TableCell>Próxima ocorrência</TableCell>
                  <TableCell>Situação</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>{r.templateDescription}</TableCell>
                    <TableCell>{RECURRENCE_FREQUENCY_LABEL[r.frequency]}</TableCell>
                    <TableCell align="right">{money(r.templateAmount)}</TableCell>
                    <TableCell>{formatDate(r.nextOccurrenceAt)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={r.active ? "Ativa" : "Inativa"} color={r.active ? "success" : "default"} />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" color="inherit" onClick={() => toggle.mutate(r)} disabled={toggle.isPending}>
                        {r.active ? "Desativar" : "Reativar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      {creating && <CreateRuleDialog onClose={() => setCreating(false)} />}
    </Page>
  );
}
