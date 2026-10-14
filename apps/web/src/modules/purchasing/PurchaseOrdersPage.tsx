// apps/web/src/modules/purchasing/PurchaseOrdersPage.tsx
import { useState } from "react";
import { Button, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import UploadFileIcon from "@mui/icons-material/UploadFileOutlined";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { orderTotal, purchaseOrdersApi, PO_STATUS, type PurchaseOrder, type PurchaseOrderStatus } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, money } from "../../shared/ui/format";

export function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<{ kind: "send" | "cancel"; order: PurchaseOrder } | null>(null);
  const query = useQuery({ queryKey: ["purchase-orders", status], queryFn: () => purchaseOrdersApi.list(status || undefined) });

  const mutation = useMutation({
    mutationFn: ({ kind, order }: { kind: "send" | "cancel"; order: PurchaseOrder }) =>
      kind === "send" ? purchaseOrdersApi.send(order.id) : purchaseOrdersApi.cancel(order.id),
    onSuccess: (_, { kind }) => {
      toast.success(kind === "send" ? "Ordem enviada ao fornecedor." : "Ordem cancelada.");
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setPending(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setPending(null);
    },
  });

  return (
    <Page>
      <PageHeader
        title="Ordens de compra"
        subtitle="A API retorna todas as ordens do tenant sem paginação."
        actions={
          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to="/compras/importar-xml" variant="outlined" startIcon={<UploadFileIcon />}>
              Importar XML de NF-e
            </Button>
            <Button component={RouterLink} to="/compras/nova" variant="contained" startIcon={<AddIcon />}>
              Nova ordem de compra
            </Button>
          </Stack>
        }
      />
      <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ mb: 2, minWidth: 240 }}>
        <MenuItem value="">Todos</MenuItem>
        {(Object.keys(PO_STATUS) as PurchaseOrderStatus[]).map((s) => (
          <MenuItem key={s} value={s}>
            {PO_STATUS[s].label}
          </MenuItem>
        ))}
      </TextField>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma ordem de compra encontrada.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Nº</TableCell>
                  <TableCell>Fornecedor</TableCell>
                  <TableCell>Criada em</TableCell>
                  <TableCell>Previsão</TableCell>
                  <TableCell align="right">Itens</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id} hover>
                    <TableCell>#{o.orderNumber}</TableCell>
                    <TableCell>{o.supplier?.name ?? "—"}</TableCell>
                    <TableCell>{formatDate(o.createdAt)}</TableCell>
                    <TableCell>{formatDate(o.expectedAt)}</TableCell>
                    <TableCell align="right">{o.items.length}</TableCell>
                    <TableCell align="right">{money(orderTotal(o))}</TableCell>
                    <TableCell>
                      <Chip size="small" label={PO_STATUS[o.status].label} color={PO_STATUS[o.status].color} />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" component={RouterLink} to={`/compras/${o.id}`}>
                        {o.status === "SENT" || o.status === "PARTIALLY_RECEIVED" ? "Receber" : "Detalhes"}
                      </Button>
                      {o.status === "DRAFT" && (
                        <Button size="small" onClick={() => setPending({ kind: "send", order: o })}>
                          Enviar
                        </Button>
                      )}
                      {o.status !== "RECEIVED" && o.status !== "CANCELLED" && (
                        <Button size="small" color="inherit" onClick={() => setPending({ kind: "cancel", order: o })}>
                          Cancelar
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
      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === "send" ? "Enviar ordem ao fornecedor" : "Cancelar ordem de compra"}
        message={
          pending?.kind === "send"
            ? `Marcar a ordem #${pending.order.orderNumber} como enviada?`
            : `Cancelar a ordem #${pending?.order.orderNumber}? Itens já recebidos não são estornados.`
        }
        confirmLabel={pending?.kind === "send" ? "Enviar" : "Cancelar ordem"}
        busy={mutation.isPending}
        onConfirm={() => pending && mutation.mutate(pending)}
        onClose={() => setPending(null)}
      />
    </Page>
  );
}
