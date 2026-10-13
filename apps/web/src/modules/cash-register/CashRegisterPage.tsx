// apps/web/src/modules/cash-register/CashRegisterPage.tsx
// Abertura/fechamento de caixa, sangria/suprimento e resumo do caixa atual.
// Lacuna do backend: não existe endpoint de listagem de caixas anteriores; o "histórico"
// mostrado é o de movimentações do caixa aberto e o resultado do último fechamento feito nesta sessão.
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
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDateTime, money, parseDecimal, toNumber } from "../../shared/ui/format";

interface CashRegister {
  id: string;
  status: "OPEN" | "CLOSED";
  openingAmount: string;
  closingAmount: string | null;
  expectedAmount: string | null;
  divergenceAmount: string | null;
  openedAt: string;
  closedAt: string | null;
}

interface CashMovement {
  id: string;
  type: "WITHDRAWAL" | "INJECTION";
  amount: string;
  reason: string;
  createdAt: string;
}

interface CashRegisterDetail extends CashRegister {
  movements: CashMovement[];
}

const MOVEMENT_LABEL = { WITHDRAWAL: "Sangria", INJECTION: "Suprimento" } as const;

function MovementDialog({ registerId, onClose }: { registerId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<"WITHDRAWAL" | "INJECTION">("WITHDRAWAL");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { type: string; amount: number; reason: string }) =>
      api.post<CashMovement>(`/cash-registers/${registerId}/movements`, input),
    onSuccess: () => {
      toast.success("Movimentação registrada.");
      void queryClient.invalidateQueries({ queryKey: ["cash-register"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    const value = parseDecimal(amount);
    if (value === null || value <= 0) return setFormError("Informe um valor maior que zero.");
    if (reason.trim().length < 3) return setFormError("Informe o motivo (mínimo 3 caracteres).");
    mutation.mutate({ type, amount: value, reason: reason.trim() });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Sangria / Suprimento</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField select label="Tipo" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <MenuItem value="WITHDRAWAL">Sangria (retirada)</MenuItem>
            <MenuItem value="INJECTION">Suprimento (reforço de troco)</MenuItem>
          </TextField>
          <TextField label="Valor (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          Registrar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CloseDialog({ registerId, onClose, onClosed }: { registerId: string; onClose: () => void; onClosed: (r: CashRegister) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [counted, setCounted] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (countedAmount: number) => api.post<CashRegister>(`/cash-registers/${registerId}/close`, { countedAmount }),
    onSuccess: (register) => {
      toast.success("Caixa fechado.");
      void queryClient.invalidateQueries({ queryKey: ["cash-register"] });
      onClosed(register);
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    const value = parseDecimal(counted);
    if (value === null || value < 0) return setFormError("Informe o valor contado em caixa.");
    mutation.mutate(value);
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Fechar caixa</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Alert severity="info">Conte o dinheiro físico. O sistema calcula o esperado (abertura + vendas em dinheiro − troco − sangrias + suprimentos) e a divergência.</Alert>
          <TextField label="Valor contado (R$)" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          Fechar caixa
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function OpenForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState("100,00");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (openingAmount: number) => api.post<CashRegister>("/cash-registers", { openingAmount }),
    onSuccess: () => {
      toast.success("Caixa aberto.");
      void queryClient.invalidateQueries({ queryKey: ["cash-register"] });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    const value = parseDecimal(amount);
    if (value === null || value < 0) return setFormError("Informe o fundo de troco inicial.");
    mutation.mutate(value);
  }

  return (
    <Paper sx={{ p: 3, maxWidth: 480 }}>
      <Stack spacing={2}>
        <Alert severity="warning">Nenhum caixa aberto para o seu usuário.</Alert>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField label="Fundo de troco inicial (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? "Abrindo…" : "Abrir caixa"}
        </Button>
      </Stack>
    </Paper>
  );
}

function OpenRegister({ registerId, onClosed }: { registerId: string; onClosed: (r: CashRegister) => void }) {
  const [moving, setMoving] = useState(false);
  const [closing, setClosing] = useState(false);
  const detail = useQuery({
    queryKey: ["cash-register", "detail", registerId],
    queryFn: () => api.get<CashRegisterDetail>(`/cash-registers/${registerId}`),
  });

  return (
    <QueryState query={detail}>
      {(register) => {
        const sum = (type: CashMovement["type"]) =>
          register.movements.filter((m) => m.type === type).reduce((acc, m) => acc + toNumber(m.amount), 0);
        const withdrawals = sum("WITHDRAWAL");
        const injections = sum("INJECTION");
        const balance = toNumber(register.openingAmount) + injections - withdrawals;
        return (
          <>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={3} justifyContent="space-between">
                <Stack spacing={0.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h6">Caixa atual</Typography>
                    <Chip size="small" color="success" label="Aberto" />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    Aberto em {formatDateTime(register.openedAt)}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                  <Stat label="Abertura" value={money(register.openingAmount)} />
                  <Stat label="Suprimentos" value={money(injections)} />
                  <Stat label="Sangrias" value={money(withdrawals)} />
                  <Stat label="Saldo (sem vendas)" value={money(balance)} hint="Vendas em dinheiro entram no cálculo do fechamento." />
                </Stack>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Button variant="outlined" onClick={() => setMoving(true)}>
                    Sangria / Suprimento
                  </Button>
                  <Button variant="contained" onClick={() => setClosing(true)}>
                    Fechar caixa
                  </Button>
                </Stack>
              </Stack>
            </Paper>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Movimentações do caixa
            </Typography>
            {register.movements.length === 0 ? (
              <Alert severity="info">Nenhuma sangria ou suprimento neste caixa.</Alert>
            ) : (
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Data</TableCell>
                      <TableCell>Tipo</TableCell>
                      <TableCell align="right">Valor</TableCell>
                      <TableCell>Motivo</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...register.movements]
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                      .map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>{formatDateTime(m.createdAt)}</TableCell>
                          <TableCell>{MOVEMENT_LABEL[m.type]}</TableCell>
                          <TableCell align="right" sx={{ color: m.type === "WITHDRAWAL" ? "error.main" : "success.main" }}>
                            {m.type === "WITHDRAWAL" ? "−" : "+"} {money(m.amount)}
                          </TableCell>
                          <TableCell>{m.reason}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {moving && <MovementDialog registerId={register.id} onClose={() => setMoving(false)} />}
            {closing && <CloseDialog registerId={register.id} onClose={() => setClosing(false)} onClosed={onClosed} />}
          </>
        );
      }}
    </QueryState>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Stack title={hint}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="subtitle1">{value}</Typography>
    </Stack>
  );
}

export function CashRegisterPage() {
  const current = useQuery({ queryKey: ["cash-register", "current"], queryFn: () => api.get<CashRegister | null>("/cash-registers/current") });
  const [lastClosed, setLastClosed] = useState<CashRegister | null>(null);

  return (
    <Page maxWidth={1000}>
      <PageHeader title="Caixa" subtitle="Abertura, sangria/suprimento e fechamento do seu caixa." />
      {lastClosed && (
        <Alert severity={toNumber(lastClosed.divergenceAmount) === 0 ? "success" : "warning"} sx={{ mb: 2 }} onClose={() => setLastClosed(null)}>
          Último fechamento: esperado {money(lastClosed.expectedAmount)} · contado {money(lastClosed.closingAmount)} · divergência{" "}
          {money(lastClosed.divergenceAmount)}
        </Alert>
      )}
      <QueryState query={current} isEmpty={() => false}>
        {(register) => (register ? <OpenRegister registerId={register.id} onClosed={setLastClosed} /> : <OpenForm />)}
      </QueryState>
    </Page>
  );
}
