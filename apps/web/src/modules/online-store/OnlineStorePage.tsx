// apps/web/src/modules/online-store/OnlineStorePage.tsx
// Capítulo 8.5 — Vitrine Virtual/Loja Online: tela do lojista para configurar a
// loja pública e acompanhar/avançar os pedidos recebidos pela internet. GAP DE
// AUDITORIA FECHADO (Mega-Audit Rodada 2, item 11) — primeira tela real a usar
// `OnlineStoreSettings`/`OnlineOrder`.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  onlineStoreApi,
  ONLINE_ORDER_STATUS_LABEL,
  type OnlineOrder,
  type OnlineOrderStatus,
  type OnlineStoreSettingsInput,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { money, formatDateTime } from "../../shared/ui/format";

const EMPTY_SETTINGS: OnlineStoreSettingsInput = {
  isActive: false,
  customSlug: "",
  primaryColorHex: "#4F46E5",
  deliveryEnabled: false,
  deliveryFee: null,
  minOrderAmount: null,
};

function SettingsTab() {
  const toast = useToast();
  const query = useQuery({ queryKey: ["online-store-settings"], queryFn: () => onlineStoreApi.getSettings() });
  const [form, setForm] = useState<OnlineStoreSettingsInput | null>(null);

  const save = useMutation({
    mutationFn: (input: OnlineStoreSettingsInput) => onlineStoreApi.saveSettings(input),
    onSuccess: () => {
      toast.success("Configurações da loja salvas.");
      query.refetch();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <QueryState query={query}>
      {(settings) => {
        const current =
          form ??
          (settings
            ? {
                isActive: settings.isActive,
                customSlug: settings.customSlug,
                primaryColorHex: settings.primaryColorHex,
                logoStorageKey: settings.logoStorageKey,
                deliveryEnabled: settings.deliveryEnabled,
                deliveryFee: settings.deliveryFee ? Number(settings.deliveryFee) : null,
                minOrderAmount: settings.minOrderAmount ? Number(settings.minOrderAmount) : null,
              }
            : EMPTY_SETTINGS);

        const storeUrl = `${window.location.origin}/loja/${current.customSlug || "..."}`;

        return (
          <Paper sx={{ p: 3, maxWidth: 560 }}>
            <Stack spacing={2}>
              <FormControlLabel
                control={<Switch checked={current.isActive} onChange={(e) => setForm({ ...current, isActive: e.target.checked })} />}
                label="Loja ativa (visível publicamente)"
              />
              <TextField
                label="Endereço da loja (slug)"
                value={current.customSlug}
                onChange={(e) => setForm({ ...current, customSlug: e.target.value.toLowerCase() })}
                helperText={`Será acessível em: ${storeUrl}`}
                fullWidth
              />
              <TextField
                label="Cor principal"
                type="color"
                value={current.primaryColorHex}
                onChange={(e) => setForm({ ...current, primaryColorHex: e.target.value })}
                sx={{ width: 160 }}
              />
              <FormControlLabel
                control={<Switch checked={current.deliveryEnabled} onChange={(e) => setForm({ ...current, deliveryEnabled: e.target.checked })} />}
                label="Esta loja realiza entrega"
              />
              {current.deliveryEnabled && (
                <TextField
                  label="Taxa de entrega (R$)"
                  type="number"
                  value={current.deliveryFee ?? ""}
                  onChange={(e) => setForm({ ...current, deliveryFee: e.target.value === "" ? null : Number(e.target.value) })}
                />
              )}
              <TextField
                label="Pedido mínimo (R$, opcional)"
                type="number"
                value={current.minOrderAmount ?? ""}
                onChange={(e) => setForm({ ...current, minOrderAmount: e.target.value === "" ? null : Number(e.target.value) })}
              />
              <Button
                variant="contained"
                disabled={!current.customSlug || save.isPending}
                onClick={() => save.mutate(current)}
              >
                Salvar configurações
              </Button>
            </Stack>
          </Paper>
        );
      }}
    </QueryState>
  );
}

const STATUS_COLOR: Record<OnlineOrderStatus, "default" | "info" | "warning" | "success" | "error" | "primary"> = {
  PENDING: "warning",
  CONFIRMED: "info",
  PREPARING: "primary",
  OUT_FOR_DELIVERY: "primary",
  DELIVERED: "success",
  CANCELLED: "error",
};

const NEXT_STATUS: Partial<Record<OnlineOrderStatus, OnlineOrderStatus>> = {
  PENDING: "CONFIRMED",
  CONFIRMED: "PREPARING",
  PREPARING: "OUT_FOR_DELIVERY",
  OUT_FOR_DELIVERY: "DELIVERED",
};

function OrdersTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["online-store-orders"], queryFn: () => onlineStoreApi.orders() });
  const [orderToCancel, setOrderToCancel] = useState<OnlineOrder | null>(null);

  const advance = useMutation({
    mutationFn: ({ order, status }: { order: OnlineOrder; status: OnlineOrderStatus }) => onlineStoreApi.updateOrderStatus(order.id, status),
    onSuccess: () => {
      toast.success("Status do pedido atualizado.");
      queryClient.invalidateQueries({ queryKey: ["online-store-orders"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const cancel = useMutation({
    mutationFn: ({ order, reason }: { order: OnlineOrder; reason: string }) => onlineStoreApi.updateOrderStatus(order.id, "CANCELLED", reason),
    onSuccess: () => {
      toast.success("Pedido cancelado.");
      queryClient.invalidateQueries({ queryKey: ["online-store-orders"] });
      setOrderToCancel(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <>
      <QueryState query={query} isEmpty={(data) => data.length === 0} emptyMessage="Nenhum pedido recebido pela loja online ainda.">
        {(orders) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Data</TableCell>
                  <TableCell>Cliente</TableCell>
                  <TableCell>Itens</TableCell>
                  <TableCell>Total</TableCell>
                  <TableCell>Entrega</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((order) => {
                  const next = NEXT_STATUS[order.status];
                  return (
                    <TableRow key={order.id}>
                      <TableCell>{formatDateTime(order.createdAt)}</TableCell>
                      <TableCell>
                        {order.customerName}
                        <br />
                        <Typography variant="caption" color="text.secondary">
                          {order.customerPhone}
                        </Typography>
                      </TableCell>
                      <TableCell>{order.items.map((i) => `${i.quantity}x ${i.productName}`).join(", ")}</TableCell>
                      <TableCell>{money(order.totalAmount)}</TableCell>
                      <TableCell>{order.isDelivery ? order.deliveryAddress ?? "Entrega" : "Retirada no local"}</TableCell>
                      <TableCell>
                        <Chip size="small" label={ONLINE_ORDER_STATUS_LABEL[order.status]} color={STATUS_COLOR[order.status]} />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {next && (
                            <Button size="small" variant="outlined" onClick={() => advance.mutate({ order, status: next })}>
                              {ONLINE_ORDER_STATUS_LABEL[next]}
                            </Button>
                          )}
                          {order.status !== "DELIVERED" && order.status !== "CANCELLED" && (
                            <Button size="small" color="error" onClick={() => setOrderToCancel(order)}>
                              Cancelar
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      <ConfirmDialog
        open={orderToCancel !== null}
        title="Cancelar pedido"
        message={`Cancelar o pedido de ${orderToCancel?.customerName} (${orderToCancel ? money(orderToCancel.totalAmount) : ""})? Informe o motivo do cancelamento; o cliente poderá ser notificado.`}
        confirmLabel="Confirmar cancelamento"
        requireReason
        reasonLabel="Motivo do cancelamento (obrigatório)"
        busy={cancel.isPending}
        onConfirm={(reason) => orderToCancel && reason && cancel.mutate({ order: orderToCancel, reason })}
        onClose={() => setOrderToCancel(null)}
      />
    </>
  );
}

export function OnlineStorePage() {
  const [tab, setTab] = useState<"settings" | "orders">("settings");
  return (
    <Page>
      <PageHeader title="Loja Online" subtitle="Vitrine virtual pública para seus clientes finais fazerem pedidos pela internet." />
      <Alert severity="info" sx={{ mb: 2 }}>
        Pedidos feitos na loja NUNCA baixam estoque automaticamente — você confirma cada pedido e, ao atendê-lo, lança a venda normalmente
        no PDV.
      </Alert>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="settings" label="Configurações" />
        <Tab value="orders" label="Pedidos recebidos" />
      </Tabs>
      {tab === "settings" ? <SettingsTab /> : <OrdersTab />}
    </Page>
  );
}
