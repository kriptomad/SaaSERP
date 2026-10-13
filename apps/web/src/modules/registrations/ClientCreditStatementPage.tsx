// apps/web/src/modules/registrations/ClientCreditStatementPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.6 — Varejo Geral (Crediário/Fiado).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: o cadastro de cliente (PartiesPage.tsx)
// já editava `creditLimit`, mas não existia nenhuma tela de conta-corrente/extrato de
// fiado (limite, saldo usado, saldo disponível, histórico de vendas STORE_CREDIT e
// pagamentos registrados) nem forma de dar baixa parcial no saldo em aberto.
// Consome GET /clients/:id/credit-statement e POST /clients/:id/credit-payments
// (apps/api/src/modules/clients/credit-payments.routes.ts).
import { useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
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
import { clientsApi, clientCreditApi, type Client } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { useDebounced } from "../../shared/ui/useDebounced";
import { money, formatDateTime, parseDecimal } from "../../shared/ui/format";

function ClientPicker({ value, onChange }: { value: Client | null; onChange: (client: Client | null) => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim());
  const query = useQuery<Client[]>({
    queryKey: ["clients", "credit-picker", debounced],
    queryFn: () => clientsApi.list(debounced || undefined),
  });

  return (
    <Autocomplete
      options={query.data ?? []}
      loading={query.isFetching}
      value={value}
      onChange={(_, client) => onChange(client)}
      getOptionLabel={(client) => `${client.name}${client.document ? ` — ${client.document}` : ""}`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onInputChange={(_, text) => setSearch(text)}
      renderInput={(params) => <TextField {...params} label="Buscar cliente por nome ou CPF/CNPJ" />}
      noOptionsText="Nenhum cliente encontrado."
    />
  );
}

function PaymentForm({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const parsedAmount = parseDecimal(amount);
      if (!parsedAmount || parsedAmount <= 0) {
        throw new Error("Informe um valor de pagamento maior que zero.");
      }
      return clientCreditApi.registerPayment(clientId, { amount: parsedAmount, note: note.trim() || null });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clients", "credit-statement", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Pagamento de crediário registrado com sucesso.");
      setAmount("");
      setNote("");
      setFormError(null);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" gutterBottom>
          Registrar pagamento (baixa de crediário)
        </Typography>
        <Stack spacing={2}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Valor pago (R$)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              fullWidth
            />
            <TextField label="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
          </Stack>
          <Button
            variant="contained"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            sx={{ alignSelf: "flex-start" }}
          >
            {mutation.isPending ? "Registrando…" : "Registrar pagamento"}
          </Button>
          <Typography variant="caption" color="text.secondary">
            Um valor maior que o saldo em aberto apenas zera o saldo usado — nunca cria saldo negativo.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function StatementPanel({ client }: { client: Client }) {
  const query = useQuery({
    queryKey: ["clients", "credit-statement", client.id],
    queryFn: () => clientCreditApi.getStatement(client.id),
  });

  return (
    <QueryState query={query}>
      {(statement) => (
        <Stack spacing={3}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    Limite de crédito
                  </Typography>
                  <Typography variant="h6">{money(statement.creditLimit)}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    Saldo usado
                  </Typography>
                  <Typography variant="h6" color="warning.main">
                    {money(statement.creditBalanceUsed)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    Saldo disponível
                  </Typography>
                  <Typography variant="h6" color="success.main">
                    {money(statement.availableLimit)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <PaymentForm clientId={client.id} />

          <Typography variant="subtitle1">Vendas a prazo (STORE_CREDIT)</Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Data</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Valor</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {statement.storeCreditSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Alert severity="info">Nenhuma venda a prazo registrada para este cliente.</Alert>
                    </TableCell>
                  </TableRow>
                ) : (
                  statement.storeCreditSales.map((sale) => (
                    <TableRow key={sale.id} hover>
                      <TableCell>{formatDateTime(sale.createdAt)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={sale.status} />
                      </TableCell>
                      <TableCell align="right">{money(sale.totalAmount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="subtitle1">Pagamentos registrados</Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Data</TableCell>
                  <TableCell>Observação</TableCell>
                  <TableCell align="right">Valor</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {statement.payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Alert severity="info">Nenhum pagamento registrado ainda.</Alert>
                    </TableCell>
                  </TableRow>
                ) : (
                  statement.payments.map((payment) => (
                    <TableRow key={payment.id} hover>
                      <TableCell>{formatDateTime(payment.createdAt)}</TableCell>
                      <TableCell>{payment.note ?? "—"}</TableCell>
                      <TableCell align="right">{money(payment.amount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      )}
    </QueryState>
  );
}

export function ClientCreditStatementPage() {
  const [client, setClient] = useState<Client | null>(null);

  return (
    <Page>
      <PageHeader
        title="Conta-corrente do cliente (Crediário/Fiado)"
        subtitle="Capítulo 4.6 — Varejo Geral: limite, saldo usado, saldo disponível, histórico de vendas a prazo e pagamentos."
      />
      <Stack spacing={3}>
        <ClientPicker value={client} onChange={setClient} />
        {client ? (
          <StatementPanel key={client.id} client={client} />
        ) : (
          <Alert severity="info">Selecione um cliente para ver o extrato de crediário.</Alert>
        )}
      </Stack>
    </Page>
  );
}
