// apps/web/src/modules/personal-finance/PersonalDebtsPage.tsx
// Capítulo 22.6/22.7 — dívidas de longo prazo (financiamentos, empréstimos, cartão
// parcelado, cheque especial) com parcelas e calculadora de quitação antecipada
// (Snowball vs. Avalanche).
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CalculateIcon from "@mui/icons-material/Calculate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, money, parseDecimal } from "../../shared/ui/format";
import { DEBT_TYPE_LABEL, personalFinanceApi, type DebtPayoffPlanMonth, type PersonalDebt, type PersonalDebtType } from "./api";

const INSTALLMENT_STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", PAID: "Paga", OVERDUE: "Vencida" };

function CreateDebtDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<PersonalDebtType>("EMPRESTIMO_PESSOAL");
  const [originalAmount, setOriginalAmount] = useState("");
  const [remainingAmount, setRemainingAmount] = useState("");
  const [interestRateMonthly, setInterestRateMonthly] = useState("");
  const [installmentsTotal, setInstallmentsTotal] = useState("");
  const [installmentsPaid, setInstallmentsPaid] = useState("0");
  const [dueDay, setDueDay] = useState("");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => personalFinanceApi.createDebt(body),
    onSuccess: () => {
      toast.success("Dívida cadastrada.");
      void queryClient.invalidateQueries({ queryKey: ["personal-debts"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    const original = parseDecimal(originalAmount);
    const remaining = parseDecimal(remainingAmount);
    const rate = parseDecimal(interestRateMonthly);
    const total = Number(installmentsTotal);
    const paid = Number(installmentsPaid || "0");
    const day = Number(dueDay);
    const installment = parseDecimal(installmentAmount);
    if (!name.trim()) return setFormError("Informe o nome da dívida.");
    if (original === null || original <= 0) return setFormError("Informe o valor original.");
    if (remaining === null || remaining <= 0) return setFormError("Informe o saldo devedor atual.");
    if (rate === null || rate < 0) return setFormError("Informe a taxa de juros mensal.");
    if (!total || total <= 0) return setFormError("Informe o total de parcelas.");
    if (!day || day < 1 || day > 31) return setFormError("Informe o dia de vencimento (1-31).");
    if (installment === null || installment <= 0) return setFormError("Informe o valor da parcela.");
    mutation.mutate({
      name: name.trim(),
      type,
      originalAmount: original,
      remainingAmount: remaining,
      interestRateMonthly: rate,
      installmentsTotal: total,
      installmentsPaid: paid,
      dueDay: day,
      installmentAmount: installment,
    });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova dívida</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField select label="Tipo" value={type} onChange={(e) => setType(e.target.value as PersonalDebtType)}>
            {(Object.keys(DEBT_TYPE_LABEL) as PersonalDebtType[]).map((t) => (
              <MenuItem key={t} value={t}>
                {DEBT_TYPE_LABEL[t]}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Valor original (R$)" value={originalAmount} onChange={(e) => setOriginalAmount(e.target.value)} required fullWidth />
            <TextField label="Saldo devedor atual (R$)" value={remainingAmount} onChange={(e) => setRemainingAmount(e.target.value)} required fullWidth />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Juros mensal (%)" value={interestRateMonthly} onChange={(e) => setInterestRateMonthly(e.target.value)} required fullWidth />
            <TextField label="Valor da parcela (R$)" value={installmentAmount} onChange={(e) => setInstallmentAmount(e.target.value)} required fullWidth />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Total de parcelas" value={installmentsTotal} onChange={(e) => setInstallmentsTotal(e.target.value)} required fullWidth />
            <TextField label="Parcelas já pagas" value={installmentsPaid} onChange={(e) => setInstallmentsPaid(e.target.value)} fullWidth />
            <TextField label="Dia de vencimento" value={dueDay} onChange={(e) => setDueDay(e.target.value)} required fullWidth />
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

function PayoffSimulationDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [extraMonthlyBudget, setExtraMonthlyBudget] = useState("");
  const [strategy, setStrategy] = useState<"AVALANCHE" | "SNOWBALL">("AVALANCHE");
  const [result, setResult] = useState<{ plan: DebtPayoffPlanMonth[]; monthsToPayoff: number } | null>(null);

  const mutation = useMutation({
    mutationFn: () => personalFinanceApi.simulatePayoff({ extraMonthlyBudget: parseDecimal(extraMonthlyBudget) ?? 0, strategy }),
    onSuccess: (data) => setResult(data),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Simular quitação antecipada</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Estratégias: <b>Avalanche</b> prioriza a dívida com maior taxa de juros; <b>Snowball</b> prioriza a de menor saldo devedor.
          </Typography>
          <TextField label="Orçamento extra mensal (R$)" value={extraMonthlyBudget} onChange={(e) => setExtraMonthlyBudget(e.target.value)} />
          <TextField select label="Estratégia" value={strategy} onChange={(e) => setStrategy(e.target.value as "AVALANCHE" | "SNOWBALL")}>
            <MenuItem value="AVALANCHE">Avalanche (menor juros pago)</MenuItem>
            <MenuItem value="SNOWBALL">Snowball (motivação — quita mais rápido)</MenuItem>
          </TextField>
          {result && (
            <Alert severity="success">
              {result.monthsToPayoff === 0
                ? "Nenhuma dívida ativa para simular."
                : `Com este orçamento extra, suas dívidas ativas serão quitadas em ${result.monthsToPayoff} mês(es).`}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        <Button variant="contained" startIcon={<CalculateIcon />} onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Calculando…" : "Simular"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DebtRow({ debt }: { debt: PersonalDebt }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);

  const pay = useMutation({
    mutationFn: (installmentId: string) => personalFinanceApi.payInstallment(debt.id, installmentId),
    onSuccess: () => {
      toast.success("Parcela paga.");
      void queryClient.invalidateQueries({ queryKey: ["personal-debts"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const pct = Math.min(100, (debt.installmentsPaid / debt.installmentsTotal) * 100 || 0);

  return (
    <>
      <TableRow hover>
        <TableCell>
          <IconButton size="small" onClick={() => setExpanded((v) => !v)} aria-label="Expandir parcelas">
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
          {debt.name}
        </TableCell>
        <TableCell>{DEBT_TYPE_LABEL[debt.type]}</TableCell>
        <TableCell align="right">{money(debt.remainingAmount)}</TableCell>
        <TableCell align="right">{Number(debt.interestRateMonthly).toFixed(2)}% a.m.</TableCell>
        <TableCell>
          {debt.installmentsPaid}/{debt.installmentsTotal}
          <Box sx={{ width: 100, mt: 0.5 }}>
            <LinearProgress variant="determinate" value={pct} />
          </Box>
        </TableCell>
        <TableCell>
          <Chip size="small" label={debt.status === "PAID_OFF" ? "Quitada" : "Ativa"} color={debt.status === "PAID_OFF" ? "success" : "warning"} />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={6} sx={{ py: 0, border: 0 }}>
          <Collapse in={expanded}>
            <Box sx={{ my: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Parcela</TableCell>
                    <TableCell>Vencimento</TableCell>
                    <TableCell align="right">Valor</TableCell>
                    <TableCell>Situação</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {debt.installments.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.installmentNumber}</TableCell>
                      <TableCell>{formatDate(i.dueDate)}</TableCell>
                      <TableCell align="right">{money(i.amount)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={INSTALLMENT_STATUS_LABEL[i.status]}
                          color={i.status === "PAID" ? "success" : i.status === "OVERDUE" ? "error" : "default"}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {i.status !== "PAID" && (
                          <Button size="small" onClick={() => pay.mutate(i.id)} disabled={pay.isPending}>
                            Pagar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export function PersonalDebtsPage() {
  const query = useQuery({ queryKey: ["personal-debts"], queryFn: () => personalFinanceApi.debts(), staleTime: 30_000 });
  const [creating, setCreating] = useState(false);
  const [simulating, setSimulating] = useState(false);

  return (
    <Page maxWidth={1300}>
      <PageHeader
        title="Dívidas"
        actions={
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<CalculateIcon />} onClick={() => setSimulating(true)}>
              Simular quitação
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
              Nova dívida
            </Button>
          </Stack>
        }
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma dívida cadastrada.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Dívida</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell align="right">Saldo devedor</TableCell>
                  <TableCell align="right">Juros</TableCell>
                  <TableCell>Parcelas</TableCell>
                  <TableCell>Situação</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((d) => (
                  <DebtRow key={d.id} debt={d} />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      {creating && <CreateDebtDialog onClose={() => setCreating(false)} />}
      {simulating && <PayoffSimulationDialog onClose={() => setSimulating(false)} />}
    </Page>
  );
}
