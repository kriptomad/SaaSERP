// apps/web/src/modules/financial/AccountsPage.tsx
// Contas a Pagar e a Receber. Contratos de financial.routes.ts:
//  - POST /accounts-payable/:id/pay | /cancel ; POST /accounts-receivable/:id/receive
//  - Não há endpoint de cancelamento para recebíveis (lacuna do backend).
//  - Listagem paginada de verdade (page/pageSize/meta.total) — "Carregar mais" na UI.
import { useMemo, useState } from "react";
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
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker, SupplierPicker } from "../../shared/lookups";
import { dateInputToIso, formatDate, money, parseDecimal, toDateInput, toNumber } from "../../shared/ui/format";
import type { Client } from "../registrations/api";

type Kind = "payable" | "receivable";
type Status = "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";

interface ChartAccount {
  id: string;
  code: string;
  name: string;
  nature: "REVENUE" | "EXPENSE";
}

interface Account {
  id: string;
  description: string;
  amount: string;
  dueDate: string;
  status: Status;
  paidAt: string | null;
  supplier?: { id: string; name: string } | null;
  client?: { id: string; name: string } | null;
  chartOfAccount?: { id: string; name: string } | null;
}

const CONFIG = {
  payable: {
    title: "Contas a pagar",
    path: "/accounts-payable",
    queryKey: "accounts-payable",
    partyLabel: "Fornecedor",
    paidVerb: "Pagar",
    paidLabel: "Paga",
    nature: "EXPENSE",
  },
  receivable: {
    title: "Contas a receber",
    path: "/accounts-receivable",
    queryKey: "accounts-receivable",
    partyLabel: "Cliente",
    paidVerb: "Receber",
    paidLabel: "Recebida",
    nature: "REVENUE",
  },
} as const;

const STATUS_LABEL: Record<Status, string> = { PENDING: "Pendente", PAID: "Quitada", OVERDUE: "Vencida", CANCELLED: "Cancelada" };

interface ChargeResult {
  type: "BOLETO" | "PIX";
  pixQrCodePayload: string | null;
  boletoDigitableLine: string | null;
  invoiceUrl: string;
  bankSlipUrl: string | null;
}

function ChargeDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const toast = useToast();
  const [billingType, setBillingType] = useState<"PIX" | "BOLETO">("PIX");
  const [result, setResult] = useState<ChargeResult | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.post<ChargeResult>(`/accounts-receivable/${account.id}/charge`, { billingType }),
    onSuccess: (data) => setResult(data),
    onError: (error) => toast.error(errorMessage(error)),
  });

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    toast.success("Copiado.");
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Cobrar — {account.description}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Cliente: {account.client?.name ?? "—"} · Valor: {money(account.amount)}
          </Typography>
          {!result && (
            <TextField select label="Forma de cobrança" value={billingType} onChange={(e) => setBillingType(e.target.value as "PIX" | "BOLETO")}>
              <MenuItem value="PIX">Pix</MenuItem>
              <MenuItem value="BOLETO">Boleto</MenuItem>
            </TextField>
          )}
          {result?.type === "PIX" && result.pixQrCodePayload && (
            <Stack spacing={1}>
              <Typography variant="subtitle2">Pix copia-e-cola</Typography>
              <TextField value={result.pixQrCodePayload} multiline rows={3} InputProps={{ readOnly: true }} />
              <Button startIcon={<ContentCopyIcon />} onClick={() => copy(result.pixQrCodePayload!)}>
                Copiar código Pix
              </Button>
            </Stack>
          )}
          {result?.type === "BOLETO" && result.boletoDigitableLine && (
            <Stack spacing={1}>
              <Typography variant="subtitle2">Linha digitável do boleto</Typography>
              <TextField value={result.boletoDigitableLine} InputProps={{ readOnly: true }} />
              <Button startIcon={<ContentCopyIcon />} onClick={() => copy(result.boletoDigitableLine!)}>
                Copiar linha digitável
              </Button>
              {result.bankSlipUrl && (
                <Button href={result.bankSlipUrl} target="_blank" rel="noreferrer">
                  Abrir PDF do boleto
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        {!result && (
          <Button variant="contained" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Gerando…" : "Gerar cobrança"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function CreateDialog({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const cfg = CONFIG[kind];
  const queryClient = useQueryClient();
  const toast = useToast();
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(toDateInput(new Date()));
  const [chartId, setChartId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const charts = useQuery({ queryKey: ["chart-of-accounts"], queryFn: () => api.get<ChartAccount[]>("/chart-of-accounts") });

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Account>(cfg.path, body),
    onSuccess: () => {
      toast.success("Conta criada.");
      void queryClient.invalidateQueries({ queryKey: [cfg.queryKey] });
      void queryClient.invalidateQueries({ queryKey: ["cash-flow"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    const value = parseDecimal(amount);
    if (kind === "payable" && !supplierId) return setFormError("Selecione o fornecedor.");
    if (kind === "receivable" && !client) return setFormError("Selecione o cliente.");
    if (!description.trim()) return setFormError("Informe a descrição.");
    if (value === null || value <= 0) return setFormError("Informe um valor maior que zero.");
    if (!dueDate) return setFormError("Informe o vencimento.");
    mutation.mutate({
      ...(kind === "payable" ? { supplierId } : { clientId: client!.id }),
      description: description.trim(),
      amount: value,
      dueDate: dateInputToIso(dueDate),
      ...(chartId ? { chartOfAccountId: chartId } : {}),
    });
  }

  const chartOptions = (charts.data ?? []).filter((c) => c.nature === cfg.nature);

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova conta a {kind === "payable" ? "pagar" : "receber"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          {kind === "payable" ? (
            <SupplierPicker value={supplierId} onChange={setSupplierId} required />
          ) : (
            <ClientPicker value={client} onChange={setClient} required />
          )}
          <TextField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} required />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Valor (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} required fullWidth />
            <TextField
              label="Vencimento"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              required
              fullWidth
            />
          </Stack>
          <TextField
            select
            label="Conta contábil (opcional)"
            value={chartId}
            onChange={(e) => setChartId(e.target.value)}
            helperText={charts.isError ? "Plano de contas indisponível para seu perfil." : undefined}
          >
            <MenuItem value="">Sem classificação</MenuItem>
            {chartOptions.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.code} — {c.name}
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

export function AccountsPage({ kind }: { kind: Kind }) {
  const cfg = CONFIG[kind];
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<{ action: "settle" | "cancel"; account: Account } | null>(null);
  const [charging, setCharging] = useState<Account | null>(null);
  // CORREÇÃO DE AUDITORIA (full-audit, sev. 78): a listagem vinha sempre truncada em
  // 200 registros sem nenhuma forma de acessar os demais. Agora o backend pagina de
  // verdade (financial.routes.ts) e esta tela acumula páginas via "Carregar mais".
  const PAGE_SIZE = 50;
  const [loadedPages, setLoadedPages] = useState(1);

  const query = useQuery({
    queryKey: [cfg.queryKey, status, loadedPages],
    queryFn: () => api.getPaged<Account[]>(cfg.path, { status: status || undefined, page: 1, pageSize: PAGE_SIZE * loadedPages }),
  });
  const rows = query.data?.data ?? [];
  const total = query.data?.meta?.total ?? rows.length;
  const hasMore = rows.length < total;

  const mutation = useMutation({
    mutationFn: ({ action, account }: { action: "settle" | "cancel"; account: Account }) =>
      api.post<Account>(`${cfg.path}/${account.id}/${action === "cancel" ? "cancel" : kind === "payable" ? "pay" : "receive"}`),
    onSuccess: (_, { action }) => {
      toast.success(action === "cancel" ? "Conta cancelada." : kind === "payable" ? "Pagamento registrado." : "Recebimento registrado.");
      void queryClient.invalidateQueries({ queryKey: [cfg.queryKey] });
      void queryClient.invalidateQueries({ queryKey: ["cash-flow"] });
      setPending(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setPending(null);
    },
  });

  const totals = useMemo(() => {
    const open = rows.filter((a) => a.status === "PENDING" || a.status === "OVERDUE");
    return { count: open.length, amount: open.reduce((s, a) => s + toNumber(a.amount), 0) };
  }, [rows]);

  const now = Date.now();

  return (
    <Page>
      <PageHeader
        title={cfg.title}
        subtitle={query.data ? `Em aberto: ${totals.count} conta(s) · ${money(totals.amount)} · exibindo ${rows.length} de ${total}` : undefined}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
            Nova conta
          </Button>
        }
      />
      <TextField
        select
        size="small"
        label="Status"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setLoadedPages(1);
        }}
        sx={{ mb: 2, minWidth: 200 }}
      >
        <MenuItem value="">Todos</MenuItem>
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <MenuItem key={s} value={s}>
            {STATUS_LABEL[s]}
          </MenuItem>
        ))}
      </TextField>
      <QueryState query={query} isEmpty={(d) => d.data.length === 0} emptyMessage="Nenhuma conta encontrada.">
        {() => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Vencimento</TableCell>
                  <TableCell>{cfg.partyLabel}</TableCell>
                  <TableCell>Descrição</TableCell>
                  <TableCell>Conta contábil</TableCell>
                  <TableCell align="right">Valor</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((a) => {
                  const open = a.status === "PENDING" || a.status === "OVERDUE";
                  const late = a.status === "PENDING" && new Date(a.dueDate).getTime() < now;
                  return (
                    <TableRow key={a.id} hover>
                      <TableCell>{formatDate(a.dueDate)}</TableCell>
                      <TableCell>{(kind === "payable" ? a.supplier?.name : a.client?.name) ?? "—"}</TableCell>
                      <TableCell>{a.description}</TableCell>
                      <TableCell>{a.chartOfAccount?.name ?? "—"}</TableCell>
                      <TableCell align="right">{money(a.amount)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={late ? "Vencida" : a.status === "PAID" ? cfg.paidLabel : STATUS_LABEL[a.status]}
                          color={a.status === "PAID" ? "success" : late || a.status === "OVERDUE" ? "error" : a.status === "CANCELLED" ? "default" : "warning"}
                        />
                        {a.paidAt && (
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                            {formatDate(a.paidAt)}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {open && (
                          <Button size="small" onClick={() => setPending({ action: "settle", account: a })}>
                            {cfg.paidVerb}
                          </Button>
                        )}
                        {open && kind === "receivable" && a.client && (
                          <Button size="small" onClick={() => setCharging(a)}>
                            Cobrar
                          </Button>
                        )}
                        {open && kind === "payable" && (
                          <Button size="small" color="inherit" onClick={() => setPending({ action: "cancel", account: a })}>
                            Cancelar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      {hasMore && (
        <Stack direction="row" justifyContent="center" sx={{ mt: 2 }}>
          <Button onClick={() => setLoadedPages((p) => p + 1)} disabled={query.isFetching}>
            {query.isFetching ? "Carregando…" : `Carregar mais (${rows.length} de ${total})`}
          </Button>
        </Stack>
      )}
      {creating && <CreateDialog kind={kind} onClose={() => setCreating(false)} />}
      {charging && <ChargeDialog account={charging} onClose={() => setCharging(null)} />}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.action === "cancel" ? "Cancelar conta" : `${cfg.paidVerb} conta`}
        message={`${pending?.account.description} — ${money(pending?.account.amount)}`}
        confirmLabel={pending?.action === "cancel" ? "Cancelar conta" : `Confirmar (${cfg.paidVerb.toLowerCase()})`}
        busy={mutation.isPending}
        onConfirm={() => pending && mutation.mutate(pending)}
        onClose={() => setPending(null)}
      />
    </Page>
  );
}

export function PayablesPage() {
  return <AccountsPage kind="payable" />;
}

export function ReceivablesPage() {
  return <AccountsPage kind="receivable" />;
}
