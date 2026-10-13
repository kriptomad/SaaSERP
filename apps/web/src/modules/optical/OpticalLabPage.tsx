// apps/web/src/modules/optical/OpticalLabPage.tsx
// Capítulo 11.2 — Ótica: acompanhamento do pedido de laboratório óptico aberto
// automaticamente ao confirmar venda de lente de grau (close-sale.service.ts),
// com transição de status (RECEIVED → IN_REPAIR → READY → DELIVERED/CANCELLED)
// e notificação ao cliente quando o status muda para READY (feita no backend).
import { useState } from "react";
import {
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
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, formatDateTime } from "../../shared/ui/format";
import { opticalLabWorkOrdersApi, type OpticalLabWorkOrderStatus } from "./api";

const STATUS_LABEL: Record<OpticalLabWorkOrderStatus, string> = {
  RECEIVED: "Recebido",
  IN_REPAIR: "Em produção",
  READY: "Pronto para retirada",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};

const STATUS_OPTIONS: OpticalLabWorkOrderStatus[] = ["RECEIVED", "IN_REPAIR", "READY", "DELIVERED", "CANCELLED"];
// O backend (`optical-lab-work-orders.routes.ts`) só aceita transição para estes status —
// RECEIVED é o estado inicial de criação, nunca um destino de transição manual.
const TRANSITION_OPTIONS: OpticalLabWorkOrderStatus[] = ["IN_REPAIR", "READY", "DELIVERED", "CANCELLED"];

function StatusSelect({ orderId, status }: { orderId: string; status: OpticalLabWorkOrderStatus }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (next: OpticalLabWorkOrderStatus) => opticalLabWorkOrdersApi.setStatus(orderId, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["optical-lab-work-orders"] });
      toast.success("Status atualizado.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // RECEIVED é o estado inicial de criação (nunca um destino de transição manual no
  // backend) — mantido na lista só quando é o valor atual, para o <select> ter uma
  // opção selecionada válida.
  const options = status === "RECEIVED" ? (["RECEIVED", ...TRANSITION_OPTIONS] as OpticalLabWorkOrderStatus[]) : TRANSITION_OPTIONS;

  return (
    <TextField
      select
      size="small"
      value={status}
      onChange={(e) => mutation.mutate(e.target.value as OpticalLabWorkOrderStatus)}
      disabled={mutation.isPending}
      sx={{ minWidth: 180 }}
    >
      {options.map((s) => (
        <MenuItem key={s} value={s}>
          {STATUS_LABEL[s]}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function OpticalLabPage() {
  const [statusFilter, setStatusFilter] = useState<OpticalLabWorkOrderStatus | "">("");
  const query = useQuery({
    queryKey: ["optical-lab-work-orders", statusFilter],
    queryFn: () => opticalLabWorkOrdersApi.list(statusFilter || undefined),
  });

  return (
    <Page>
      <PageHeader
        title="Laboratório óptico"
        subtitle="Pedidos de laboratório abertos automaticamente na venda de lente de grau — prazo de entrega e status."
        actions={
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OpticalLabWorkOrderStatus | "")} sx={{ minWidth: 200 }}>
            <MenuItem value="">Todos</MenuItem>
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum pedido de laboratório óptico encontrado.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Cliente</TableCell>
                    <TableCell>Receita</TableCell>
                    <TableCell>Aberto em</TableCell>
                    <TableCell>Previsão de entrega</TableCell>
                    <TableCell>Entregue em</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((o) => (
                    <TableRow key={o.id} hover>
                      <TableCell>
                        {o.client.name}
                        {o.client.phone ? ` (${o.client.phone})` : ""}
                      </TableCell>
                      <TableCell>{o.opticalPrescription ? `#${o.opticalPrescription.prescriptionNumber}` : "—"}</TableCell>
                      <TableCell>{formatDateTime(o.createdAt)}</TableCell>
                      <TableCell>{formatDate(o.estimatedReadyAt)}</TableCell>
                      <TableCell>{formatDateTime(o.deliveredAt)}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <StatusSelect orderId={o.id} status={o.status} />
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
    </Page>
  );
}
