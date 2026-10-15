// apps/web/src/modules/personal-finance/PersonalAccountsPage.tsx
// Capítulo 22.2 — carteira de contas da residência (corrente, poupança, dinheiro
// físico, cartão de crédito, corretora). Rota /pessoal/carteiras (distinta de
// /pessoal/contas, que é a tela de Contas a Pagar — ver PersonalBillsPage.tsx).
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
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import SyncIcon from "@mui/icons-material/Sync";
import ArchiveIcon from "@mui/icons-material/Archive";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { money, parseDecimal } from "../../shared/ui/format";
import { ACCOUNT_TYPE_LABEL, personalFinanceApi, type PersonalAccount, type PersonalAccountType } from "./api";

function AccountDialog({ account, onClose }: { account: PersonalAccount | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<PersonalAccountType>(account?.type ?? "CHECKING");
  const [institutionName, setInstitutionName] = useState(account?.institutionName ?? "");
  const [currentBalance, setCurrentBalance] = useState(account ? String(Number(account.currentBalance)) : "0");
  const [creditLimit, setCreditLimit] = useState(account?.creditLimit ? String(Number(account.creditLimit)) : "");
  const [invoiceClosingDay, setInvoiceClosingDay] = useState(account?.invoiceClosingDay ? String(account.invoiceClosingDay) : "");
  const [invoiceDueDay, setInvoiceDueDay] = useState(account?.invoiceDueDay ? String(account.invoiceDueDay) : "");
  const [isShared, setIsShared] = useState(account?.isShared ?? true);
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      account ? personalFinanceApi.updateAccount(account.id, body) : personalFinanceApi.createAccount(body),
    onSuccess: () => {
      toast.success("Conta salva.");
      void queryClient.invalidateQueries({ queryKey: ["personal-accounts"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!name.trim()) return setFormError("Informe o nome da conta.");
    const balance = parseDecimal(currentBalance) ?? 0;
    const body: Record<string, unknown> = {
      name: name.trim(),
      type,
      institutionName: institutionName.trim() || undefined,
      currentBalance: balance,
      isShared,
    };
    if (type === "CREDIT_CARD") {
      const limit = parseDecimal(creditLimit);
      const closing = Number(invoiceClosingDay);
      const due = Number(invoiceDueDay);
      if (!limit || limit <= 0) return setFormError("Informe o limite do cartão.");
      if (!closing || closing < 1 || closing > 31) return setFormError("Informe o dia de fechamento (1-31).");
      if (!due || due < 1 || due > 31) return setFormError("Informe o dia de vencimento (1-31).");
      body.creditLimit = limit;
      body.invoiceClosingDay = closing;
      body.invoiceDueDay = due;
    }
    mutation.mutate(body);
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{account ? "Editar conta" : "Nova conta"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField select label="Tipo" value={type} onChange={(e) => setType(e.target.value as PersonalAccountType)}>
            {(Object.keys(ACCOUNT_TYPE_LABEL) as PersonalAccountType[]).map((t) => (
              <MenuItem key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t]}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Instituição (opcional)" value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} />
          {!account && <TextField label="Saldo inicial (R$)" value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} />}
          {type === "CREDIT_CARD" && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Limite (R$)" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} required fullWidth />
              <TextField label="Dia de fechamento" value={invoiceClosingDay} onChange={(e) => setInvoiceClosingDay(e.target.value)} required fullWidth />
              <TextField label="Dia de vencimento" value={invoiceDueDay} onChange={(e) => setInvoiceDueDay(e.target.value)} required fullWidth />
            </Stack>
          )}
          <FormControlLabel
            control={<Switch checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />}
            label="Conta compartilhada entre todos os moradores"
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

function ReconcileDialog({ account, onClose }: { account: PersonalAccount; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [result, setResult] = useState<{ previousCachedBalance: string; recalculatedBalance: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () => personalFinanceApi.reconcileAccount(account.id),
    onSuccess: (data) => {
      setResult({ previousCachedBalance: data.previousCachedBalance, recalculatedBalance: data.recalculatedBalance });
      void queryClient.invalidateQueries({ queryKey: ["personal-accounts"] });
      toast.success("Conta reconciliada a partir do histórico de transações.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Reconciliar — {account.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Recalcula o saldo do zero a partir de todo o histórico de transações desta conta, útil se você suspeitar de alguma
            divergência no saldo exibido.
          </Typography>
          <Typography variant="body2">Saldo atual (em cache): {money(account.currentBalance)}</Typography>
          {result && (
            <Alert severity={result.previousCachedBalance === result.recalculatedBalance ? "success" : "warning"}>
              Saldo recalculado: {money(result.recalculatedBalance)}
              {result.previousCachedBalance !== result.recalculatedBalance && " — divergência corrigida."}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        {!result && (
          <Button variant="contained" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Reconciliando…" : "Reconciliar agora"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function PersonalAccountsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["personal-accounts"], queryFn: () => personalFinanceApi.accounts() });
  const [editing, setEditing] = useState<PersonalAccount | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reconciling, setReconciling] = useState<PersonalAccount | null>(null);

  const archive = useMutation({
    mutationFn: (a: PersonalAccount) => personalFinanceApi.updateAccount(a.id, { archived: !a.archivedAt }),
    onSuccess: (_, a) => {
      toast.success(a.archivedAt ? "Conta reativada." : "Conta arquivada.");
      void queryClient.invalidateQueries({ queryKey: ["personal-accounts"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Page>
      <PageHeader
        title="Minhas contas"
        subtitle={
          query.data
            ? `Saldo total: ${money(query.data.filter((a) => !a.archivedAt).reduce((s, a) => s + Number(a.currentBalance), 0))}`
            : undefined
        }
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Nova conta
          </Button>
        }
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma conta cadastrada ainda.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Nome</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell>Instituição</TableCell>
                  <TableCell align="right">Saldo</TableCell>
                  <TableCell>Compartilhada</TableCell>
                  <TableCell>Situação</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id} hover>
                    <TableCell>{a.name}</TableCell>
                    <TableCell>{ACCOUNT_TYPE_LABEL[a.type]}</TableCell>
                    <TableCell>{a.institutionName ?? "—"}</TableCell>
                    <TableCell align="right">{money(a.currentBalance)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={a.isShared ? "Sim" : "Individual"} />
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={a.archivedAt ? "Arquivada" : "Ativa"} color={a.archivedAt ? "default" : "success"} />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Editar">
                        <IconButton
                          size="small"
                          aria-label={`Editar ${a.name}`}
                          onClick={() => {
                            setEditing(a);
                            setDialogOpen(true);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Reconciliar saldo">
                        <IconButton size="small" aria-label={`Reconciliar ${a.name}`} onClick={() => setReconciling(a)}>
                          <SyncIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={a.archivedAt ? "Reativar" : "Arquivar"}>
                        <IconButton size="small" aria-label={`Arquivar ${a.name}`} onClick={() => archive.mutate(a)} disabled={archive.isPending}>
                          <ArchiveIcon fontSize="small" />
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
      {dialogOpen && <AccountDialog key={editing?.id ?? "new"} account={editing} onClose={() => setDialogOpen(false)} />}
      {reconciling && <ReconcileDialog account={reconciling} onClose={() => setReconciling(null)} />}
    </Page>
  );
}
