// apps/web/src/modules/personal-finance/PersonalTransactionsPage.tsx
// Capítulo 22.2/22.3 — lançamentos (receita/despesa/transferência) da residência.
// Rota /pessoal/transacoes (mantida igual ao `linkRoute` usado por
// personal-recurrence-generation.worker.ts para o link da notificação).
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
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
  Tabs,
  Tab,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import LockIcon from "@mui/icons-material/Lock";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useToast } from "../../shared/ui/Toast";
import { dateInputToIso, formatDate, money, parseDecimal, toDateInput } from "../../shared/ui/format";
import {
  ACCOUNT_TYPE_LABEL,
  personalFinanceApi,
  type PersonalAccount,
  type PersonalCategory,
  type PersonalCategoryType,
  type PersonalTransaction,
  type PersonalTransactionType,
} from "./api";

type EntryKind = "INCOME" | "EXPENSE" | "TRANSFER";

const ENTRY_KIND_LABEL: Record<EntryKind, string> = { INCOME: "Receita", EXPENSE: "Despesa", TRANSFER: "Transferência" };

function CategoryQuickCreate({ type, onCreated }: { type: PersonalCategoryType; onCreated: (category: PersonalCategory) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const mutation = useMutation({
    mutationFn: () => personalFinanceApi.createCategory({ name: name.trim(), type }),
    onSuccess: (category) => {
      toast.success("Categoria criada.");
      void queryClient.invalidateQueries({ queryKey: ["personal-categories"] });
      onCreated(category);
      setOpen(false);
      setName("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!open) {
    return (
      <Button size="small" onClick={() => setOpen(true)}>
        + Nova categoria
      </Button>
    );
  }

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <TextField size="small" label="Nome da categoria" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <Button size="small" variant="contained" disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
        Criar
      </Button>
      <Button size="small" onClick={() => setOpen(false)}>
        Cancelar
      </Button>
    </Stack>
  );
}

function CreateTransactionDialog({
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
  const [kind, setKind] = useState<EntryKind>("EXPENSE");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState(toDateInput(new Date()));
  const [isPrivate, setIsPrivate] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation<PersonalTransaction | { outgoing: PersonalTransaction; incoming: PersonalTransaction }, Error, Record<string, unknown>>({
    mutationFn: (body: Record<string, unknown>) => (kind === "TRANSFER" ? personalFinanceApi.createTransfer(body) : personalFinanceApi.createTransaction(body)),
    onSuccess: () => {
      toast.success("Lançamento registrado.");
      void queryClient.invalidateQueries({ queryKey: ["personal-transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["personal-accounts"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const categoryOptions = categories.filter((c) => c.type === (kind === "INCOME" ? "INCOME" : "EXPENSE"));

  function submit() {
    setFormError(null);
    const value = parseDecimal(amount);
    if (value === null || value <= 0) return setFormError("Informe um valor maior que zero.");
    if (!description.trim()) return setFormError("Informe a descrição.");
    if (!transactionDate) return setFormError("Informe a data.");

    if (kind === "TRANSFER") {
      if (!accountId) return setFormError("Selecione a conta de origem.");
      if (!toAccountId) return setFormError("Selecione a conta de destino.");
      if (accountId === toAccountId) return setFormError("Conta de origem e destino não podem ser a mesma.");
      mutation.mutate({ fromAccountId: accountId, toAccountId, amount: value, description: description.trim() });
      return;
    }

    if (!accountId) return setFormError("Selecione a conta.");
    mutation.mutate({
      accountId,
      categoryId: categoryId || undefined,
      description: description.trim(),
      merchantName: merchantName.trim() || undefined,
      type: kind as PersonalTransactionType,
      amount: value,
      transactionDate: dateInputToIso(transactionDate),
      isPrivate,
    });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo lançamento</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Tabs value={kind} onChange={(_, v) => setKind(v)} variant="fullWidth">
            {(Object.keys(ENTRY_KIND_LABEL) as EntryKind[]).map((k) => (
              <Tab key={k} value={k} label={ENTRY_KIND_LABEL[k]} />
            ))}
          </Tabs>
          <TextField
            select
            label={kind === "TRANSFER" ? "Conta de origem" : "Conta"}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            {accounts.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name} ({ACCOUNT_TYPE_LABEL[a.type]})
              </MenuItem>
            ))}
          </TextField>
          {kind === "TRANSFER" && (
            <TextField select label="Conta de destino" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
              {accounts.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.name} ({ACCOUNT_TYPE_LABEL[a.type]})
                </MenuItem>
              ))}
            </TextField>
          )}
          {kind !== "TRANSFER" && (
            <Stack spacing={1}>
              <TextField select label="Categoria (opcional)" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <MenuItem value="">Sem categoria</MenuItem>
                {categoryOptions.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>
              <CategoryQuickCreate type={kind === "INCOME" ? "INCOME" : "EXPENSE"} onCreated={(c) => setCategoryId(c.id)} />
            </Stack>
          )}
          <TextField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} required />
          {kind !== "TRANSFER" && (
            <TextField label="Estabelecimento (opcional)" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} />
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Valor (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} required fullWidth />
            {kind !== "TRANSFER" && (
              <TextField
                label="Data"
                type="date"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                required
                fullWidth
              />
            )}
          </Stack>
          {kind !== "TRANSFER" && (
            <FormControlLabel
              control={<Switch checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />}
              label="Lançamento privado (visível só para mim)"
            />
          )}
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

export function PersonalTransactionsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PersonalTransaction | null>(null);

  const accountsQuery = useQuery({ queryKey: ["personal-accounts"], queryFn: () => personalFinanceApi.accounts() });
  const categoriesQuery = useQuery({ queryKey: ["personal-categories"], queryFn: () => personalFinanceApi.categories() });
  const transactionsQuery = useQuery({
    queryKey: ["personal-transactions", accountId, categoryId, from, to],
    queryFn: () =>
      personalFinanceApi.transactions({
        accountId: accountId || undefined,
        categoryId: categoryId || undefined,
        from: from ? dateInputToIso(from) : undefined,
        to: to ? dateInputToIso(to) : undefined,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => personalFinanceApi.deleteTransaction(id),
    onSuccess: () => {
      toast.success("Lançamento excluído.");
      void queryClient.invalidateQueries({ queryKey: ["personal-transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["personal-accounts"] });
      setDeleting(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleting(null);
    },
  });

  const accountsById = useMemo(() => new Map((accountsQuery.data ?? []).map((a) => [a.id, a])), [accountsQuery.data]);

  const typeLabel: Record<PersonalTransactionType, string> = { INCOME: "Receita", EXPENSE: "Despesa", TRANSFER: "Transferência" };
  const typeColor: Record<PersonalTransactionType, "success" | "error" | "default"> = { INCOME: "success", EXPENSE: "error", TRANSFER: "default" };

  return (
    <Page maxWidth={1400}>
      <PageHeader
        title="Transações"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
            Novo lançamento
          </Button>
        }
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <TextField select size="small" label="Conta" value={accountId} onChange={(e) => setAccountId(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">Todas</MenuItem>
          {(accountsQuery.data ?? []).map((a) => (
            <MenuItem key={a.id} value={a.id}>
              {a.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">Todas</MenuItem>
          {(categoriesQuery.data ?? []).map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="De"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField size="small" label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
      </Stack>
      <QueryState query={transactionsQuery} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma transação encontrada para este filtro.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Data</TableCell>
                  <TableCell>Descrição</TableCell>
                  <TableCell>Conta</TableCell>
                  <TableCell>Categoria</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell align="right">Valor</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} hover>
                    <TableCell>{formatDate(t.transactionDate)}</TableCell>
                    <TableCell>
                      {t.description}
                      {t.isPrivate && (
                        <Tooltip title="Lançamento privado">
                          <LockIcon fontSize="inherit" sx={{ ml: 0.5, verticalAlign: "middle", color: "text.secondary" }} />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>{accountsById.get(t.accountId)?.name ?? "—"}</TableCell>
                    <TableCell>{t.category?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Chip size="small" label={typeLabel[t.type]} color={typeColor[t.type]} />
                    </TableCell>
                    <TableCell align="right">{money(t.amount)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Excluir">
                        <IconButton size="small" aria-label={`Excluir ${t.description}`} onClick={() => setDeleting(t)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      {creating && (
        <CreateTransactionDialog accounts={accountsQuery.data ?? []} categories={categoriesQuery.data ?? []} onClose={() => setCreating(false)} />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Excluir lançamento"
        message={`${deleting?.description} — ${money(deleting?.amount)}. O saldo da conta será ajustado automaticamente.`}
        confirmLabel="Excluir"
        busy={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </Page>
  );
}
