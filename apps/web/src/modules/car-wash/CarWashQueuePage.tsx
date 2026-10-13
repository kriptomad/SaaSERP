// apps/web/src/modules/car-wash/CarWashQueuePage.tsx
// Capítulo 11.11 — Estética Automotiva/Lava-Rápido: painel de fila de hoje
// (walk-in), avanço de status e tempo médio de atendimento por serviço.
// Comissão do lavador/esteticista: NÃO implementada aqui — reaproveita
// ServiceCommissionEntry/commissionPercentage já existentes (ver
// apps/web/src/modules/scheduling/*, aba "Comissões"), gerada no fechamento da
// Comanda, não pela fila em si.
import { useState } from "react";
import {
  Alert,
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
import { carWashQueueApi, CAR_WASH_STATUS_LABEL, type CarWashQueueEntry } from "./api";
import { schedulingApi } from "../scheduling/api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker, useProfessionals } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { formatDateTime } from "../../shared/ui/format";

const ADVANCEABLE: CarWashQueueEntry["status"][] = ["SCHEDULED", "IN_PROGRESS"];

function statusColor(status: CarWashQueueEntry["status"]): "default" | "info" | "warning" | "success" | "error" | "primary" {
  if (status === "COMPLETED") return "success";
  if (status === "IN_PROGRESS") return "primary";
  if (status === "CANCELLED" || status === "NO_SHOW") return "error";
  return "default";
}

function WalkInForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [client, setClient] = useState<Client | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const services = useQuery({ queryKey: ["services"], queryFn: () => schedulingApi.services() });
  const professionals = useProfessionals();

  const createWalkIn = useMutation({
    mutationFn: () =>
      carWashQueueApi.createWalkIn({
        clientId: client!.id,
        serviceId,
        vehiclePlate: vehiclePlate.trim() || undefined,
        professionalId: professionalId || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["car-wash-queue-today"] });
      toast.success("Cliente adicionado à fila de hoje.");
      setClient(null);
      setServiceId("");
      setProfessionalId("");
      setVehiclePlate("");
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Chegada espontânea (walk-in)
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="flex-start" flexWrap="wrap">
        <Stack sx={{ minWidth: 260 }}>
          <ClientPicker value={client} onChange={setClient} label="Cliente" required />
        </Stack>
        <TextField select label="Serviço" value={serviceId} onChange={(e) => setServiceId(e.target.value)} sx={{ minWidth: 220 }} required>
          {(services.data ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Profissional (opcional)"
          value={professionalId}
          onChange={(e) => setProfessionalId(e.target.value)}
          sx={{ minWidth: 220 }}
          helperText="Em branco: atribuição automática ao menos ocupado hoje"
        >
          <MenuItem value="">Auto-atribuir</MenuItem>
          {(professionals.data ?? []).map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Placa (opcional)" value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} sx={{ minWidth: 160 }} />
        <Button
          variant="contained"
          disabled={!client || !serviceId || createWalkIn.isPending}
          onClick={() => {
            setError(null);
            createWalkIn.mutate();
          }}
        >
          {createWalkIn.isPending ? "Adicionando…" : "Adicionar à fila"}
        </Button>
      </Stack>
    </Paper>
  );
}

function QueueTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["car-wash-queue-today"], queryFn: () => carWashQueueApi.today() });

  const advance = useMutation({
    mutationFn: (appointmentId: string) => carWashQueueApi.advanceStatus(appointmentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["car-wash-queue-today"] });
      toast.success("Status avançado.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Stack spacing={2}>
      <WalkInForm />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum atendimento na fila de hoje.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Chegada</TableCell>
                    <TableCell>Cliente</TableCell>
                    <TableCell>Veículo</TableCell>
                    <TableCell>Serviço</TableCell>
                    <TableCell>Profissional</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell>{formatDateTime(row.scheduledAt)}</TableCell>
                      <TableCell>
                        {row.client.name}
                        {row.client.phone && ` (${row.client.phone})`}
                      </TableCell>
                      <TableCell>{row.vehicle ? `${row.vehicle.licensePlate} — ${row.vehicle.model}` : "—"}</TableCell>
                      <TableCell>{row.service.name}</TableCell>
                      <TableCell>{row.professional.name}</TableCell>
                      <TableCell>
                        <Chip size="small" label={CAR_WASH_STATUS_LABEL[row.status]} color={statusColor(row.status)} />
                      </TableCell>
                      <TableCell align="right">
                        {ADVANCEABLE.includes(row.status) && (
                          <Button size="small" onClick={() => advance.mutate(row.id)} disabled={advance.isPending}>
                            Avançar status
                          </Button>
                        )}
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

function AverageTimeTab() {
  const query = useQuery({ queryKey: ["car-wash-average-time"], queryFn: () => carWashQueueApi.averageServiceTime() });
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Estimativa baseada em `Service.estimatedDurationMinutes` (planejado) — o schema de
        `Appointment` não tem `startedAt`/`completedAt` reais para medir o tempo efetivo gasto
        (ver gap documentado no backend).
      </Typography>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum atendimento concluído ainda.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Serviço</TableCell>
                    <TableCell align="right">Concluídos</TableCell>
                    <TableCell align="right">Tempo médio (min)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.serviceId} hover>
                      <TableCell>{row.serviceName}</TableCell>
                      <TableCell align="right">{row.completedCount}</TableCell>
                      <TableCell align="right">{row.averageMinutes} (estimado)</TableCell>
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

export function CarWashQueuePage() {
  const [tab, setTab] = useState(0);
  return (
    <Page>
      <PageHeader
        title="Fila do Lava-Rápido"
        subtitle="Chegada espontânea (walk-in), fila de hoje e tempo médio de atendimento (Estética Automotiva)."
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Fila de hoje" />
        <Tab label="Tempo médio" />
      </Tabs>
      {tab === 0 && <QueueTab />}
      {tab === 1 && <AverageTimeTab />}
    </Page>
  );
}
