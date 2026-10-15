// apps/web/src/modules/construction/MaterialDeliveriesPage.tsx
// Capítulo 11.8 — Material de Construção/Ferragens: agendamento e rastreio de
// entrega de material pesado/volumoso (PENDING→IN_TRANSIT→DELIVERED/CANCELLED).
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
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
import {
  materialDeliveriesApi,
  MATERIAL_DELIVERY_STATUS_LABEL,
  type MaterialDeliveryStatus,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { formatDateTime } from "../../shared/ui/format";

const STATUS_COLOR: Record<MaterialDeliveryStatus, "default" | "info" | "warning" | "success" | "error"> = {
  PENDING: "default",
  IN_TRANSIT: "info",
  DELIVERED: "success",
  CANCELLED: "error",
};

function NewDeliveryForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [client, setClient] = useState<Client | null>(null);
  const [address, setAddress] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [driverName, setDriverName] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      materialDeliveriesApi.create({
        clientId: client!.id,
        address: address.trim(),
        scheduledAt: new Date(scheduledAt).toISOString(),
        driverName: driverName.trim() || null,
        vehiclePlate: vehiclePlate.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["material-deliveries"] });
      toast.success("Entrega agendada.");
      setClient(null);
      setAddress("");
      setScheduledAt("");
      setDriverName("");
      setVehiclePlate("");
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const valid = Boolean(client) && address.trim().length > 0 && scheduledAt.length > 0;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Agendar entrega de material
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} flexWrap="wrap" useFlexGap>
        <ClientPicker value={client} onChange={setClient} label="Cliente" required />
        <TextField label="Endereço de entrega" value={address} onChange={(e) => setAddress(e.target.value)} sx={{ minWidth: 260 }} required />
        <TextField
          label="Data/hora agendada"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 220 }}
          required
        />
        <TextField label="Motorista (opcional)" value={driverName} onChange={(e) => setDriverName(e.target.value)} sx={{ minWidth: 160 }} />
        <TextField label="Placa do veículo (opcional)" value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} sx={{ minWidth: 160 }} />
        <Button
          variant="contained"
          disabled={!valid || create.isPending}
          onClick={() => {
            setError(null);
            create.mutate();
          }}
        >
          {create.isPending ? "Agendando…" : "Agendar"}
        </Button>
      </Stack>
    </Paper>
  );
}

function DeliveryActions({ id, status }: { id: string; status: MaterialDeliveryStatus }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [receivedBy, setReceivedBy] = useState("");
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof materialDeliveriesApi.update>[1]) => materialDeliveriesApi.update(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["material-deliveries"] });
      toast.success("Entrega atualizada.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (status === "PENDING") {
    return (
      <Button size="small" disabled={mutation.isPending} onClick={() => mutation.mutate({ status: "IN_TRANSIT" })}>
        Marcar em trânsito
      </Button>
    );
  }
  if (status === "IN_TRANSIT") {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          label="Recebido por"
          value={receivedBy}
          onChange={(e) => setReceivedBy(e.target.value)}
          sx={{ width: 160 }}
        />
        <Button
          size="small"
          disabled={mutation.isPending || !receivedBy.trim()}
          onClick={() => mutation.mutate({ status: "DELIVERED", receivedByName: receivedBy.trim() })}
        >
          Confirmar entrega
        </Button>
        <Button size="small" color="error" disabled={mutation.isPending} onClick={() => mutation.mutate({ status: "CANCELLED" })}>
          Cancelar
        </Button>
      </Stack>
    );
  }
  return null;
}

export function MaterialDeliveriesPage() {
  const [statusFilter, setStatusFilter] = useState<MaterialDeliveryStatus | "">("");
  const query = useQuery({ queryKey: ["material-deliveries", statusFilter], queryFn: () => materialDeliveriesApi.list(statusFilter || undefined) });

  return (
    <Page>
      <PageHeader
        title="Entregas de Material"
        subtitle="Rastreio de entrega de material pesado/volumoso agendada para construtoras/empreiteiros."
        actions={
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as MaterialDeliveryStatus | "")} sx={{ minWidth: 200 }}>
            <MenuItem value="">Todos</MenuItem>
            {(Object.keys(MATERIAL_DELIVERY_STATUS_LABEL) as MaterialDeliveryStatus[]).map((s) => (
              <MenuItem key={s} value={s}>
                {MATERIAL_DELIVERY_STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      <Stack spacing={2}>
        <NewDeliveryForm />
        <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma entrega agendada.">
          {(data) => (
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cliente</TableCell>
                      <TableCell>Endereço</TableCell>
                      <TableCell>Agendada para</TableCell>
                      <TableCell>Motorista/Veículo</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Ações</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.map((d) => (
                      <TableRow key={d.id} hover>
                        <TableCell>{d.client.name}</TableCell>
                        <TableCell>{d.address}</TableCell>
                        <TableCell>{formatDateTime(d.scheduledAt)}</TableCell>
                        <TableCell>
                          {d.driverName ?? "—"}
                          {d.vehiclePlate ? ` / ${d.vehiclePlate}` : ""}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={MATERIAL_DELIVERY_STATUS_LABEL[d.status]} color={STATUS_COLOR[d.status]} />
                        </TableCell>
                        <TableCell align="right">
                          <DeliveryActions id={d.id} status={d.status} />
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
    </Page>
  );
}
