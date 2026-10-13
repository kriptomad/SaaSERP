// apps/web/src/modules/liquor-ledger/LiquorLedgerPage.tsx
// Capítulo 4.3 — Adega/Bebidas: conta-corrente de cascos/vasilhames retornáveis,
// separada da conta-corrente financeira do cliente. Mostra saldo de cascos por
// produto, histórico de lançamentos, relatório gerencial de "cascos em atraso" e
// formulário de lançamento manual (BORROWED/RETURNED).
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
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
import {
  liquorLedgerApi,
  CONTAINER_DIRECTION_LABEL,
  type ContainerLedgerDirection,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker, ProductPicker } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { formatDateTime } from "../../shared/ui/format";

function ClientBalanceTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [client, setClient] = useState<Client | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [direction, setDirection] = useState<ContainerLedgerDirection>("BORROWED");
  const [quantity, setQuantity] = useState("1");
  const [saleId, setSaleId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const balance = useQuery({
    queryKey: ["liquor-ledger-balance", client?.id],
    queryFn: () => liquorLedgerApi.getClientBalance(client!.id),
    enabled: Boolean(client),
  });
  const entries = useQuery({
    queryKey: ["liquor-ledger-entries", client?.id],
    queryFn: () => liquorLedgerApi.listClientEntries(client!.id),
    enabled: Boolean(client),
  });

  const createEntry = useMutation({
    mutationFn: () =>
      liquorLedgerApi.createEntry({
        clientId: client!.id,
        productId: productId!,
        direction,
        quantity: Math.round(Number(quantity)),
        saleId: saleId.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["liquor-ledger-balance", client?.id] });
      void queryClient.invalidateQueries({ queryKey: ["liquor-ledger-entries", client?.id] });
      void queryClient.invalidateQueries({ queryKey: ["liquor-ledger-overdue"] });
      toast.success("Lançamento de casco registrado.");
      setProductId(null);
      setQuantity("1");
      setSaleId("");
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!productId) return setFormError("Selecione o produto (casco).");
    const qty = Math.round(Number(quantity));
    if (!qty || qty <= 0) return setFormError("Informe uma quantidade válida (maior que zero).");
    createEntry.mutate();
  }

  return (
    <Stack spacing={2}>
      <ClientPicker value={client} onChange={setClient} label="Buscar cliente" />
      {client && (
        <QueryState
          query={balance}
          isEmpty={(d) => d.balances.length === 0}
          emptyMessage="Nenhum movimento de casco para este cliente ainda."
        >
          {(data) => (
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Produto</TableCell>
                      <TableCell align="right">Emprestado (total)</TableCell>
                      <TableCell align="right">Devolvido (total)</TableCell>
                      <TableCell align="right">Saldo em aberto</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.balances.map((b) => (
                      <TableRow key={b.productId} hover>
                        <TableCell>
                          {b.productName}
                          {b.productSku && ` (${b.productSku})`}
                        </TableCell>
                        <TableCell align="right">{b.borrowed}</TableCell>
                        <TableCell align="right">{b.returned}</TableCell>
                        <TableCell align="right">
                          <Chip
                            size="small"
                            label={b.balance}
                            color={b.balance > 0 ? "warning" : "success"}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </QueryState>
      )}
      {client && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Lançamento manual de casco
          </Typography>
          {formError && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {formError}
            </Alert>
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="flex-start">
            <Box sx={{ minWidth: 260 }}>
              <ProductPicker value={productId} onChange={(p) => setProductId(p?.id ?? null)} label="Produto (casco)" />
            </Box>
            <TextField
              select
              label="Direção"
              value={direction}
              onChange={(e) => setDirection(e.target.value as ContainerLedgerDirection)}
              sx={{ minWidth: 220 }}
            >
              {Object.entries(CONTAINER_DIRECTION_LABEL).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Quantidade"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              sx={{ minWidth: 120 }}
            />
            <TextField
              label="Venda vinculada (opcional, ID)"
              value={saleId}
              onChange={(e) => setSaleId(e.target.value)}
              sx={{ minWidth: 220 }}
            />
            <Button variant="contained" onClick={submit} disabled={createEntry.isPending}>
              {createEntry.isPending ? "Lançando…" : "Lançar"}
            </Button>
          </Stack>
        </Paper>
      )}
      {client && (
        <QueryState query={entries} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum lançamento para este cliente.">
          {(data) => (
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Data</TableCell>
                      <TableCell>Produto</TableCell>
                      <TableCell>Direção</TableCell>
                      <TableCell align="right">Quantidade</TableCell>
                      <TableCell>Venda</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.map((e) => (
                      <TableRow key={e.id} hover>
                        <TableCell>{formatDateTime(e.createdAt)}</TableCell>
                        <TableCell>{e.productName}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={CONTAINER_DIRECTION_LABEL[e.direction]}
                            color={e.direction === "BORROWED" ? "warning" : "success"}
                          />
                        </TableCell>
                        <TableCell align="right">{e.quantity}</TableCell>
                        <TableCell>{e.saleId ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </QueryState>
      )}
    </Stack>
  );
}

function OverdueTab() {
  const [daysThreshold, setDaysThreshold] = useState("30");
  const query = useQuery({
    queryKey: ["liquor-ledger-overdue", daysThreshold],
    queryFn: () => liquorLedgerApi.getOverdue(Math.max(1, Math.round(Number(daysThreshold) || 30))),
  });

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            label="Prazo (dias)"
            value={daysThreshold}
            onChange={(e) => setDaysThreshold(e.target.value)}
            sx={{ maxWidth: 160 }}
          />
          <Typography variant="body2" color="text.secondary">
            Clientes com cascos emprestados há mais de este número de dias, sem devolução completa.
          </Typography>
        </Stack>
      </Paper>
      <QueryState
        query={query}
        isEmpty={(d) => d.overdue.length === 0}
        emptyMessage="Nenhum casco em atraso para o prazo informado."
      >
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Cliente</TableCell>
                    <TableCell>Telefone</TableCell>
                    <TableCell>Produto</TableCell>
                    <TableCell align="right">Qtd. em aberto</TableCell>
                    <TableCell align="right">Dias em atraso</TableCell>
                    <TableCell align="right">Cobrança sugerida (reposição)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.overdue.map((row, idx) => (
                    <TableRow key={`${row.clientId}:${row.productId}:${idx}`} hover>
                      <TableCell>{row.clientName}</TableCell>
                      <TableCell>{row.clientPhone ?? "—"}</TableCell>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell align="right">{row.outstandingQty}</TableCell>
                      <TableCell align="right">
                        <Chip size="small" color="error" label={row.ageDays} />
                      </TableCell>
                      <TableCell align="right">
                        {row.suggestedReplacementCharge !== null ? `R$ ${row.suggestedReplacementCharge.toFixed(2)}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
    </Stack>
  );
}

export function LiquorLedgerPage() {
  const [tab, setTab] = useState(0);
  return (
    <Page>
      <PageHeader
        title="Cascos/Vasilhames (Adega)"
        subtitle="Conta-corrente de posse física de cascos retornáveis — separada da conta-corrente financeira do cliente."
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Saldo por cliente" />
        <Tab label="Cascos em atraso" />
      </Tabs>
      {tab === 0 && <ClientBalanceTab />}
      {tab === 1 && <OverdueTab />}
    </Page>
  );
}
