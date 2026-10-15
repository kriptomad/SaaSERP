// apps/web/src/modules/tires/TireServiceOrdersPage.tsx
// Capítulo 11.10 — Loja de Pneus: O.S. real de montagem/balanceamento/alinhamento,
// com controle de pneus por medida (ver Product/ProductVariant) e DOT (ProductSerial).
import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
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
  tireServiceOrdersApi,
  TIRE_SERVICE_LABEL,
  type TireServiceOrderStatus,
  type TireServiceType,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { formatDateTime } from "../../shared/ui/format";

const STATUS_LABEL: Record<TireServiceOrderStatus, string> = {
  RECEIVED: "Recebido",
  IN_REPAIR: "Em execução",
  READY: "Pronto",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};
const TRANSITION_OPTIONS: TireServiceOrderStatus[] = ["IN_REPAIR", "READY", "DELIVERED", "CANCELLED"];

function NewServiceOrderForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [client, setClient] = useState<Client | null>(null);
  const [equipmentDescription, setEquipmentDescription] = useState("");
  const [services, setServices] = useState<Record<TireServiceType, { checked: boolean; unitPrice: string }>>({
    MOUNTING: { checked: false, unitPrice: "" },
    BALANCING: { checked: false, unitPrice: "" },
    ALIGNMENT: { checked: false, unitPrice: "" },
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const selected = (Object.keys(services) as TireServiceType[])
        .filter((key) => services[key].checked)
        .map((key) => ({ type: key, unitPrice: Number(services[key].unitPrice) || 0 }));
      return tireServiceOrdersApi.create({ clientId: client!.id, equipmentDescription: equipmentDescription.trim(), services: selected });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tire-service-orders"] });
      toast.success("O.S. de pneus criada.");
      setClient(null);
      setEquipmentDescription("");
      setServices({ MOUNTING: { checked: false, unitPrice: "" }, BALANCING: { checked: false, unitPrice: "" }, ALIGNMENT: { checked: false, unitPrice: "" } });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const hasAnyService = Object.values(services).some((s) => s.checked);

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Nova O.S. de pneus
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <ClientPicker value={client} onChange={setClient} label="Cliente" required />
          <TextField
            label="Descrição do veículo/pneus (ex.: placa + medida)"
            value={equipmentDescription}
            onChange={(e) => setEquipmentDescription(e.target.value)}
            sx={{ minWidth: 320 }}
            required
          />
        </Stack>
        <Stack spacing={1}>
          {(Object.keys(TIRE_SERVICE_LABEL) as TireServiceType[]).map((type) => (
            <Stack key={type} direction="row" spacing={2} alignItems="center">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={services[type].checked}
                    onChange={(e) => setServices((s) => ({ ...s, [type]: { ...s[type], checked: e.target.checked } }))}
                  />
                }
                label={TIRE_SERVICE_LABEL[type]}
              />
              <TextField
                label="Preço (R$)"
                type="number"
                size="small"
                disabled={!services[type].checked}
                value={services[type].unitPrice}
                onChange={(e) => setServices((s) => ({ ...s, [type]: { ...s[type], unitPrice: e.target.value } }))}
                sx={{ width: 140 }}
              />
            </Stack>
          ))}
        </Stack>
        <Button
          variant="contained"
          disabled={!client || !equipmentDescription.trim() || !hasAnyService || create.isPending}
          onClick={() => {
            setError(null);
            create.mutate();
          }}
        >
          {create.isPending ? "Criando…" : "Abrir O.S."}
        </Button>
      </Stack>
    </Paper>
  );
}

function StatusSelect({ orderId, status }: { orderId: string; status: TireServiceOrderStatus }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (next: TireServiceOrderStatus) => tireServiceOrdersApi.setStatus(orderId, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tire-service-orders"] });
      toast.success("Status atualizado.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const options = status === "RECEIVED" ? (["RECEIVED", ...TRANSITION_OPTIONS] as TireServiceOrderStatus[]) : TRANSITION_OPTIONS;

  return (
    <TextField select size="small" value={status} onChange={(e) => mutation.mutate(e.target.value as TireServiceOrderStatus)} disabled={mutation.isPending} sx={{ minWidth: 160 }}>
      {options.map((s) => (
        <MenuItem key={s} value={s}>
          {STATUS_LABEL[s]}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function TireServiceOrdersPage() {
  const query = useQuery({ queryKey: ["tire-service-orders"], queryFn: () => tireServiceOrdersApi.list() });

  return (
    <Page>
      <PageHeader title="O.S. de Montagem/Balanceamento/Alinhamento" subtitle="Operação real de borracharia — serviços executados, status e pneus instalados (DOT)." />
      <Stack spacing={2}>
        <NewServiceOrderForm />
        <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma O.S. de pneus registrada.">
          {(data) => (
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cliente</TableCell>
                      <TableCell>Descrição</TableCell>
                      <TableCell>Serviços</TableCell>
                      <TableCell>Aberta em</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.map((o) => (
                      <TableRow key={o.id} hover>
                        <TableCell>{o.client.name}</TableCell>
                        <TableCell>{o.equipmentDescription}</TableCell>
                        <TableCell>
                          {o.items
                            .filter((i) => i.itemType === "LABOR")
                            .map((i) => (
                              <Chip key={i.id} size="small" label={i.description} sx={{ mr: 0.5 }} />
                            ))}
                        </TableCell>
                        <TableCell>{formatDateTime(o.createdAt)}</TableCell>
                        <TableCell>
                          <StatusSelect orderId={o.id} status={o.status} />
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
