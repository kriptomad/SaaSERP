// apps/web/src/modules/comanda/ComandaPage.tsx
// Comanda eletrônica: lista de comandas abertas/fechadas, abertura, lançamento
// de itens (produto OU serviço) e fechamento com conversão em Sale real.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import PaymentIcon from "@mui/icons-material/Payment";
import CancelIcon from "@mui/icons-material/Cancel";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { comandaApi, COMANDA_STATUS_LABEL, PAYMENT_METHOD_LABEL, type Comanda, type PaymentMethod } from "./api";
import { schedulingApi } from "../scheduling/api";
import { fetchCurrentCashRegister } from "../../api/client";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { ClientPicker, ProductPicker, useProfessionals } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { money, qty, formatDateTime } from "../../shared/ui/format";

function OpenComandaDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const tables = useQuery({ queryKey: ["restaurant-tables"], queryFn: comandaApi.listTables });
  const [tableId, setTableId] = useState("");
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useMutation({
    mutationFn: () => comandaApi.open({ tableId: tableId || undefined, clientId: client?.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["comandas"] });
      toast.success("Comanda aberta.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Abrir comanda</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField select label="Mesa (opcional)" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <MenuItem value="">Sem mesa</MenuItem>
            {(tables.data ?? []).map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.label} ({t.seatCount} lugares)
              </MenuItem>
            ))}
          </TextField>
          <ClientPicker value={client} onChange={setClient} label="Cliente (opcional)" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={open.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => open.mutate()} disabled={open.isPending}>
          {open.isPending ? "Abrindo…" : "Abrir"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ComandaDetailDialog({ comandaId, onClose }: { comandaId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["comandas", comandaId], queryFn: () => comandaApi.get(comandaId) });
  const services = useQuery({ queryKey: ["services"], queryFn: schedulingApi.services });
  const professionals = useProfessionals();
  const [itemKind, setItemKind] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [product, setProduct] = useState<{ id: string } | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [itemError, setItemError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [itemToRemove, setItemToRemove] = useState<{ id: string; label: string } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [closeError, setCloseError] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["comandas", comandaId] });
    void queryClient.invalidateQueries({ queryKey: ["comandas"] });
  };

  const addItem = useMutation({
    mutationFn: () =>
      itemKind === "PRODUCT"
        ? comandaApi.addItem(comandaId, { productId: product!.id, quantity: Number(quantity), unitPrice: Number(unitPrice) })
        : comandaApi.addItem(comandaId, {
            serviceId,
            professionalId,
            quantity: Number(quantity),
            unitPrice: Number(unitPrice),
          }),
    onSuccess: () => {
      invalidate();
      setProduct(null);
      setServiceId("");
      setProfessionalId("");
      setQuantity("1");
      setUnitPrice("");
      toast.success("Item lançado.");
    },
    onError: (e) => setItemError(errorMessage(e)),
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) => comandaApi.removeItem(comandaId, itemId),
    onSuccess: () => {
      invalidate();
      toast.success("Item removido.");
      setItemToRemove(null);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setItemToRemove(null);
    },
  });

  const cancel = useMutation({
    mutationFn: () => comandaApi.cancel(comandaId),
    onSuccess: () => {
      invalidate();
      toast.success("Comanda cancelada.");
      setCancelOpen(false);
      onClose();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setCancelOpen(false);
    },
  });

  const close = useMutation({
    mutationFn: async () => {
      const current = await fetchCurrentCashRegister();
      if (!current.data?.id) throw new Error("Nenhum caixa aberto. Abra o caixa antes de fechar a comanda.");
      return comandaApi.close(comandaId, { cashRegisterId: current.data.id, paymentMethod });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Comanda fechada e venda registrada.");
      setCloseOpen(false);
      onClose();
    },
    onError: (e) => setCloseError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Comanda</DialogTitle>
      <DialogContent>
        <QueryState query={query}>
          {(comanda: Comanda) => {
            const total = comanda.items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.unitPrice), 0);
            const isOpen = comanda.status === "OPEN";
            return (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Chip label={COMANDA_STATUS_LABEL[comanda.status]} color={isOpen ? "primary" : "default"} />
                  {comanda.table && <Typography variant="body2">Mesa: {comanda.table.label}</Typography>}
                  {comanda.client && <Typography variant="body2">Cliente: {comanda.client.name}</Typography>}
                  <Typography variant="body2">Aberta em: {formatDateTime(comanda.openedAt)}</Typography>
                </Stack>

                {isOpen && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                      <Button
                        size="small"
                        variant={itemKind === "PRODUCT" ? "contained" : "outlined"}
                        onClick={() => setItemKind("PRODUCT")}
                      >
                        Produto
                      </Button>
                      <Button
                        size="small"
                        variant={itemKind === "SERVICE" ? "contained" : "outlined"}
                        onClick={() => setItemKind("SERVICE")}
                      >
                        Serviço
                      </Button>
                    </Stack>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Lançar item ({itemKind === "PRODUCT" ? "produto" : "serviço"})
                    </Typography>
                    {itemError && (
                      <Alert severity="error" sx={{ mb: 1 }}>
                        {itemError}
                      </Alert>
                    )}
                    {itemKind === "PRODUCT" ? (
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <Box sx={{ minWidth: 220, flex: 1 }}>
                          <ProductPicker
                            value={product?.id ?? null}
                            onChange={(p) => {
                              setProduct(p ? { id: p.id } : null);
                              if (p) setUnitPrice(String(Number(p.unitPrice)));
                            }}
                          />
                        </Box>
                        <TextField label="Qtd" value={quantity} onChange={(e) => setQuantity(e.target.value)} sx={{ width: 100 }} />
                        <TextField label="Preço unit." value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} sx={{ width: 140 }} />
                        <Button
                          variant="outlined"
                          startIcon={<AddIcon />}
                          disabled={addItem.isPending}
                          onClick={() => {
                            setItemError(null);
                            if (!product) return setItemError("Selecione um produto.");
                            if (!(Number(quantity) > 0)) return setItemError("Quantidade deve ser maior que zero.");
                            if (!(Number(unitPrice) > 0)) return setItemError("Preço unitário deve ser maior que zero.");
                            addItem.mutate();
                          }}
                        >
                          Lançar
                        </Button>
                      </Stack>
                    ) : (
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                          select
                          label="Serviço"
                          value={serviceId}
                          onChange={(e) => {
                            setServiceId(e.target.value);
                            const svc = services.data?.find((s) => s.id === e.target.value);
                            if (svc) setUnitPrice(String(Number(svc.basePrice)));
                          }}
                          sx={{ minWidth: 220, flex: 1 }}
                        >
                          {(services.data ?? []).map((s) => (
                            <MenuItem key={s.id} value={s.id}>
                              {s.name}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          select
                          label="Profissional"
                          value={professionalId}
                          onChange={(e) => setProfessionalId(e.target.value)}
                          sx={{ minWidth: 180 }}
                        >
                          {(professionals.data ?? []).map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                              {p.name}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField label="Qtd" value={quantity} onChange={(e) => setQuantity(e.target.value)} sx={{ width: 100 }} />
                        <TextField label="Preço unit." value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} sx={{ width: 140 }} />
                        <Button
                          variant="outlined"
                          startIcon={<AddIcon />}
                          disabled={addItem.isPending}
                          onClick={() => {
                            setItemError(null);
                            if (!serviceId) return setItemError("Selecione um serviço.");
                            if (!professionalId) return setItemError("Selecione o profissional (necessário para apurar a comissão no fechamento).");
                            if (!(Number(quantity) > 0)) return setItemError("Quantidade deve ser maior que zero.");
                            if (!(Number(unitPrice) > 0)) return setItemError("Preço unitário deve ser maior que zero.");
                            addItem.mutate();
                          }}
                        >
                          Lançar
                        </Button>
                      </Stack>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {itemKind === "PRODUCT"
                        ? "Produtos com Ficha Técnica cadastrada têm os insumos baixados automaticamente no lançamento deste item."
                        : "A comissão do profissional é calculada e liberada apenas no fechamento e pagamento da comanda."}
                    </Typography>
                  </Paper>
                )}

                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell align="right">Qtd</TableCell>
                        <TableCell align="right">Preço</TableCell>
                        <TableCell align="right">Total</TableCell>
                        {isOpen && <TableCell align="right">Ações</TableCell>}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {comanda.items.map((item) => (
                        <TableRow key={item.id} hover>
                          <TableCell>{item.product?.name ?? item.service?.name ?? "—"}</TableCell>
                          <TableCell align="right">{qty(item.quantity)}</TableCell>
                          <TableCell align="right">{money(item.unitPrice)}</TableCell>
                          <TableCell align="right">{money(Number(item.quantity) * Number(item.unitPrice))}</TableCell>
                          {isOpen && (
                            <TableCell align="right">
                              <IconButton
                                size="small"
                                aria-label="Remover item"
                                onClick={() =>
                                  setItemToRemove({ id: item.id, label: item.product?.name ?? item.service?.name ?? "item" })
                                }
                                disabled={removeItem.isPending}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="h6" align="right">
                  Total: {money(total)}
                </Typography>

                {isOpen && (
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button color="error" startIcon={<CancelIcon />} onClick={() => setCancelOpen(true)}>
                      Cancelar comanda
                    </Button>
                    <Button variant="contained" startIcon={<PaymentIcon />} onClick={() => setCloseOpen(true)}>
                      Fechar comanda
                    </Button>
                  </Stack>
                )}
              </Stack>
            );
          }}
        </QueryState>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar janela</Button>
      </DialogActions>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancelar comanda"
        message="Esta comanda será cancelada e não gerará venda. Deseja continuar?"
        confirmLabel="Cancelar comanda"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onClose={() => setCancelOpen(false)}
      />

      <ConfirmDialog
        open={itemToRemove !== null}
        title="Remover item"
        message={`Remover "${itemToRemove?.label}" da comanda? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover item"
        busy={removeItem.isPending}
        onConfirm={() => itemToRemove && removeItem.mutate(itemToRemove.id)}
        onClose={() => setItemToRemove(null)}
      />

      <Dialog open={closeOpen} onClose={() => setCloseOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Fechar comanda</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {closeError && <Alert severity="error">{closeError}</Alert>}
            <TextField
              select
              label="Forma de pagamento"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            >
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <MenuItem key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCloseOpen(false)} disabled={close.isPending}>
            Voltar
          </Button>
          <Button variant="contained" onClick={() => close.mutate()} disabled={close.isPending}>
            {close.isPending ? "Fechando…" : "Confirmar fechamento"}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

export function ComandaPage() {
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "">("OPEN");
  const query = useQuery({ queryKey: ["comandas", statusFilter], queryFn: () => comandaApi.list(statusFilter || undefined) });
  const [openDialog, setOpenDialog] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <Page>
      <PageHeader
        title="Comanda"
        subtitle="Abertura/fechamento de comandas por mesa ou cliente (restaurante/lanchonete/salão)."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpenDialog(true)}>
            Abrir comanda
          </Button>
        }
      />
      <TextField
        select
        size="small"
        label="Status"
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as "OPEN" | "")}
        sx={{ mb: 2, minWidth: 200 }}
      >
        <MenuItem value="OPEN">Abertas</MenuItem>
        <MenuItem value="">Todas</MenuItem>
      </TextField>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma comanda encontrada.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Mesa</TableCell>
                    <TableCell>Cliente</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Aberta em</TableCell>
                    <TableCell align="right">Itens</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((c) => (
                    <TableRow key={c.id} hover onClick={() => setDetailId(c.id)} sx={{ cursor: "pointer" }}>
                      <TableCell>{c.table?.label ?? "—"}</TableCell>
                      <TableCell>{c.client?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Chip size="small" label={COMANDA_STATUS_LABEL[c.status]} color={c.status === "OPEN" ? "primary" : "default"} />
                      </TableCell>
                      <TableCell>{formatDateTime(c.openedAt)}</TableCell>
                      <TableCell align="right">{c.items.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
      {openDialog && <OpenComandaDialog onClose={() => setOpenDialog(false)} />}
      {detailId && <ComandaDetailDialog comandaId={detailId} onClose={() => setDetailId(null)} />}
    </Page>
  );
}
