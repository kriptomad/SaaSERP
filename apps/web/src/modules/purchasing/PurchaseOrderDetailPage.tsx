// apps/web/src/modules/purchasing/PurchaseOrderDetailPage.tsx
// Detalhe + recebimento. POST /receive cria lote (produtos BATCH), movimenta estoque,
// recalcula custo médio e gera a Conta a Pagar automaticamente.
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
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
import { Link as RouterLink, useParams } from "react-router-dom";
import { PO_STATUS, purchaseOrdersApi, type PurchaseOrder, type ReceiveInput } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { dateInputToIso, formatDate, money, parseDecimal, qty, toDateInput, toNumber } from "../../shared/ui/format";

interface ReceiveRow {
  quantity: string;
  batchNumber: string;
  expirationDate: string;
}

function ReceiveSection({ order }: { order: PurchaseOrder }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, ReceiveRow>>({});
  const [dueDate, setDueDate] = useState(() => toDateInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
  const [formError, setFormError] = useState<string | null>(null);

  const get = (id: string): ReceiveRow => rows[id] ?? { quantity: "", batchNumber: "", expirationDate: "" };
  const patch = (id: string, change: Partial<ReceiveRow>) => setRows((prev) => ({ ...prev, [id]: { ...get(id), ...change } }));

  const mutation = useMutation({
    mutationFn: (input: ReceiveInput) => purchaseOrdersApi.receive(order.id, input),
    onSuccess: () => {
      toast.success("Recebimento registrado: estoque atualizado e conta a pagar gerada.");
      setRows({});
      void queryClient.invalidateQueries({ queryKey: ["purchase-order", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["accounts-payable"] });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    const receivedItems: ReceiveInput["receivedItems"] = [];
    for (const item of order.items) {
      const row = get(item.id);
      const quantityReceivedNow = parseDecimal(row.quantity);
      if (!quantityReceivedNow) continue;
      const remaining = toNumber(item.quantityOrdered) - toNumber(item.quantityReceived);
      const name = item.product?.name ?? item.productId;
      if (quantityReceivedNow <= 0 || quantityReceivedNow > remaining) {
        return setFormError(`${name}: quantidade recebida deve estar entre 0 e ${qty(remaining)}.`);
      }
      if (item.product?.trackingType === "BATCH" && (!row.batchNumber.trim() || !row.expirationDate)) {
        return setFormError(`${name}: informe número do lote e validade (produto controlado por lote).`);
      }
      receivedItems.push({
        purchaseOrderItemId: item.id,
        quantityReceivedNow,
        ...(row.batchNumber.trim() ? { batchNumber: row.batchNumber.trim() } : {}),
        ...(row.expirationDate ? { expirationDate: dateInputToIso(row.expirationDate) } : {}),
      });
    }
    if (receivedItems.length === 0) return setFormError("Informe a quantidade recebida de ao menos um item.");
    if (!dueDate) return setFormError("Informe o vencimento da conta a pagar.");
    mutation.mutate({ receivedItems, dueDate: dateInputToIso(dueDate) });
  }

  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Registrar recebimento
      </Typography>
      <Stack spacing={2}>
        {formError && <Alert severity="error">{formError}</Alert>}
        {order.items.map((item) => {
          const remaining = toNumber(item.quantityOrdered) - toNumber(item.quantityReceived);
          const row = get(item.id);
          const isBatch = item.product?.trackingType === "BATCH";
          return (
            <Stack key={item.id} direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
              <Typography sx={{ flex: 2 }}>
                {item.product?.name ?? item.productId}
                <Typography component="span" variant="body2" color="text.secondary">
                  {" "}
                  — pendente: {qty(remaining)}
                </Typography>
              </Typography>
              <TextField
                size="small"
                label="Recebido agora"
                value={row.quantity}
                onChange={(e) => patch(item.id, { quantity: e.target.value })}
                disabled={remaining <= 0}
                sx={{ flex: 1 }}
              />
              {isBatch && (
                <>
                  <TextField size="small" label="Lote" value={row.batchNumber} onChange={(e) => patch(item.id, { batchNumber: e.target.value })} sx={{ flex: 1 }} />
                  <TextField
                    size="small"
                    type="date"
                    label="Validade"
                    value={row.expirationDate}
                    onChange={(e) => patch(item.id, { expirationDate: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 1 }}
                  />
                </>
              )}
            </Stack>
          );
        })}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <TextField
            size="small"
            type="date"
            label="Vencimento da conta a pagar"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? "Registrando…" : "Confirmar recebimento"}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

export function PurchaseOrderDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["purchase-order", id], queryFn: () => purchaseOrdersApi.get(id), enabled: Boolean(id) });

  return (
    <Page maxWidth={960}>
      <QueryState query={query}>
        {(order) => (
          <>
            <PageHeader
              title={`Ordem de compra #${order.orderNumber}`}
              subtitle={`Fornecedor: ${order.supplier?.name ?? "—"} · criada em ${formatDate(order.createdAt)} · previsão ${formatDate(order.expectedAt)}`}
              actions={
                <Button component={RouterLink} to="/compras">
                  Voltar
                </Button>
              }
            />
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <Chip label={PO_STATUS[order.status].label} color={PO_STATUS[order.status].color} />
            </Stack>
            {order.notes && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {order.notes}
              </Typography>
            )}
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Produto</TableCell>
                    <TableCell align="right">Pedido</TableCell>
                    <TableCell align="right">Recebido</TableCell>
                    <TableCell align="right">Custo unit.</TableCell>
                    <TableCell align="right">Subtotal</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {order.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.product?.name ?? i.productId}</TableCell>
                      <TableCell align="right">{qty(i.quantityOrdered)}</TableCell>
                      <TableCell align="right">{qty(i.quantityReceived)}</TableCell>
                      <TableCell align="right">{money(i.unitCost)}</TableCell>
                      <TableCell align="right">{money(toNumber(i.quantityOrdered) * toNumber(i.unitCost))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {order.status === "DRAFT" && <Alert severity="info" sx={{ mt: 2 }}>Envie a ordem ao fornecedor na listagem para liberar o recebimento.</Alert>}
            {(order.status === "SENT" || order.status === "PARTIALLY_RECEIVED") && <ReceiveSection order={order} />}
          </>
        )}
      </QueryState>
    </Page>
  );
}
