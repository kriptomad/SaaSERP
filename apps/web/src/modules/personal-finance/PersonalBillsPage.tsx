// apps/web/src/modules/personal-finance/PersonalBillsPage.tsx
// Capítulo 22.8 — contas recorrentes do mês (aluguel, luz, água, internet,
// streaming). Rota /pessoal/contas (mantida igual ao `linkRoute` usado por
// personal-bill-reminders.worker.ts para o link da notificação de lembrete/vencida).
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
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
import { formatDate, money, parseDecimal } from "../../shared/ui/format";
import { BILL_STATUS_LABEL, personalFinanceApi, type PersonalAccount, type PersonalBill, type PersonalCategory } from "./api";

function CreateBillDialog({
  accounts,
  categories,
  onClose,
}: {
  accounts: PersonalAccount[];
  categories: PersonalCategory[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [autoDebitAccountId, setAutoDebitAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [isRecurring, setIsRecurring] = useState(true);
  const [reminderDaysBefore, setReminderDaysBefore] = useState("3");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => personalFinanceApi.createBill(body),
    onSuccess: () => {
      toast.success("Conta cadastrada.");
      void queryClient.invalidateQueries({ queryKey: ["personal-bills"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!name.trim()) return setFormError("Informe o nome da conta.");
    const value = parseDecimal(amount);
    if (value === null || value <= 0) return setFormError("Informe um valor maior que zero.");
    const day = Number(dueDay);
    if (!day || day < 1 || day > 31) return setFormError("Informe o dia de vencimento (1-31).");
    mutation.mutate({
      name: name.trim(),
      categoryId: categoryId || undefined,
      autoDebitAccountId: autoDebitAccountId || undefined,
      amount: value,
      dueDay: day,
      isRecurring,
      reminderDaysBefore: Number(reminderDaysBefore || "3"),
    });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova conta a pagar</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Nome (ex.: Aluguel, Luz, Internet)" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField select label="Categoria (opcional)" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <MenuItem value="">Sem categoria</MenuItem>
            {categories.filter((c) => c.type === "EXPENSE").map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Conta de débito automático (opcional)" value={autoDebitAccountId} onChange={(e) => setAutoDebitAccountId(e.target.value)}>
            <MenuItem value="">Nenhuma (pagamento manual)</MenuItem>
            {accounts.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Valor estimado (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} required fullWidth />
            <TextField label="Dia de vencimento" value={dueDay} onChange={(e) => setDueDay(e.target.value)} required fullWidth />
            <TextField label="Lembrar dias antes" value={reminderDaysBefore} onChange={(e) => setReminderDaysBefore(e.target.value)} fullWidth />
          </Stack>
          <FormControlLabel
            control={<Switch checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />}
            label="Conta recorrente (reabre todo mês)"
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

function PayBillDialog({ bill, onClose }: { bill: PersonalBill; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState(String(Number(bill.amount)));
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => personalFinanceApi.payBill(bill.id, body),
    onSuccess: () => {
      toast.success("Pagamento registrado.");
      void queryClient.invalidateQueries({ queryKey: ["personal-bills"] });
      void queryClient.invalidateQueries({ queryKey: ["personal-accounts"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Pagar — {bill.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Valor pago (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          {bill.autoDebitAccountId && (
            <Alert severity="info">Um lançamento de despesa será criado automaticamente na conta de débito configurada.</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            setFormError(null);
            const value = parseDecimal(amount);
            if (value === null || value <= 0) return setFormError("Informe um valor válido.");
            mutation.mutate({ amount: value });
          }}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Registrando…" : "Confirmar pagamento"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function PersonalBillsPage() {
  const query = useQuery({ queryKey: ["personal-bills"], queryFn: () => personalFinanceApi.bills() });
  const accountsQuery = useQuery({ queryKey: ["personal-accounts"], queryFn: () => personalFinanceApi.accounts() });
  const categoriesQuery = useQuery({ queryKey: ["personal-categories"], queryFn: () => personalFinanceApi.categories() });
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<PersonalBill | null>(null);

  return (
    <Page>
      <PageHeader title="Contas a pagar" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Nova conta</Button>} />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma conta a pagar cadastrada.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Nome</TableCell>
                  <TableCell align="right">Valor</TableCell>
                  <TableCell>Vencimento</TableCell>
                  <TableCell>Recorrente</TableCell>
                  <TableCell>Último pagamento</TableCell>
                  <TableCell>Situação</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id} hover>
                    <TableCell>{b.name}</TableCell>
                    <TableCell align="right">{money(b.amount)}</TableCell>
                    <TableCell>Dia {b.dueDay}</TableCell>
                    <TableCell>{b.isRecurring ? "Sim" : "Não"}</TableCell>
                    <TableCell>{formatDate(b.lastPaidAt)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={BILL_STATUS_LABEL[b.status]}
                        color={b.status === "PAID" ? "success" : b.status === "OVERDUE" ? "error" : "warning"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {b.status !== "PAID" && (
                        <Button size="small" onClick={() => setPaying(b)}>
                          Pagar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      {creating && (
        <CreateBillDialog accounts={accountsQuery.data ?? []} categories={categoriesQuery.data ?? []} onClose={() => setCreating(false)} />
      )}
      {paying && <PayBillDialog bill={paying} onClose={() => setPaying(null)} />}
    </Page>
  );
}
