// apps/web/src/modules/work-orders/WorkOrdersPage.tsx
// Kanban simples por status (colunas fixas, sem drag-and-drop — transições ocorrem no detalhe da O.S.).
// A API retorna as 100 O.S. mais recentes.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AssessmentIcon from "@mui/icons-material/Assessment";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { WO_STATUS, WO_STATUS_ORDER, workOrderTotal, workOrdersApi, type WorkOrder } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ClientPicker, useProfessionals } from "../../shared/lookups";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, money } from "../../shared/ui/format";
import type { Client } from "../registrations/api";
import { vehiclesApi } from "../client-records/api";

function NewWorkOrderDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const technicians = useProfessionals();
  const [client, setClient] = useState<Client | null>(null);
  const [equipment, setEquipment] = useState("");
  const [issue, setIssue] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Capítulo 11.9/11.10/11.11 — oficina/pneus/estética automotiva vinculam a O.S. a um veículo já
  // cadastrado do próprio cliente. Lista vazia (ex. assistência técnica) simplesmente não mostra o campo.
  const vehicles = useQuery({
    queryKey: ["vehicles-by-owner", client?.id],
    queryFn: () => vehiclesApi.list({ ownerId: client!.id }),
    enabled: !!client,
  });

  const mutation = useMutation({
    mutationFn: workOrdersApi.create,
    onSuccess: (wo) => {
      void queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      toast.success("O.S. criada.");
      navigate(`/os/${wo.id}`);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!client) return setFormError("Selecione o cliente.");
    if (equipment.trim().length < 2 || issue.trim().length < 2) return setFormError("Descreva o equipamento e o defeito relatado (mínimo 2 caracteres).");
    mutation.mutate({
      clientId: client.id,
      equipmentDescription: equipment.trim(),
      reportedIssue: issue.trim(),
      assignedTechnicianId: technicianId || null,
      vehicleId: vehicleId || null,
    });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova ordem de serviço</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <ClientPicker
            value={client}
            onChange={(c) => {
              setClient(c);
              setVehicleId("");
            }}
            required
          />
          <TextField label="Equipamento" value={equipment} onChange={(e) => setEquipment(e.target.value)} required />
          <TextField label="Defeito relatado" value={issue} onChange={(e) => setIssue(e.target.value)} required multiline minRows={2} />
          <TextField select label="Técnico responsável (opcional)" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <MenuItem value="">Sem técnico</MenuItem>
            {(technicians.data ?? []).map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          {!!vehicles.data?.length && (
            <TextField select label="Veículo (opcional)" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <MenuItem value="">Sem veículo</MenuItem>
              {vehicles.data.map((v) => (
                <MenuItem key={v.id} value={v.id}>
                  {v.licensePlate} — {v.model}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? "Criando…" : "Criar O.S."}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function WorkOrderCard({ order }: { order: WorkOrder }) {
  const navigate = useNavigate();
  return (
    <Card variant="outlined">
      <CardActionArea onClick={() => navigate(`/os/${order.id}`)}>
        <CardContent sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" noWrap>
            {order.equipmentDescription}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {order.client?.name ?? "—"}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {formatDate(order.createdAt)} · {order.assignedTechnician?.name ?? "sem técnico"}
          </Typography>
          {order.items.length > 0 && <Typography variant="caption">{money(workOrderTotal(order.items))}</Typography>}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export function WorkOrdersPage() {
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["work-orders"], queryFn: () => workOrdersApi.list() });

  return (
    <Page maxWidth={1600}>
      <PageHeader
        title="Ordens de serviço"
        subtitle="Quadro por status (as 100 O.S. mais recentes). Abra uma O.S. para mudar o status."
        actions={
          <>
            <Button variant="outlined" startIcon={<AssessmentIcon />} onClick={() => navigate("/os/relatorios")}>
              Relatórios
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
              Nova O.S.
            </Button>
          </>
        }
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma ordem de serviço. Crie a primeira em “Nova O.S.”.">
        {(orders) => (
          <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 1 }}>
            {WO_STATUS_ORDER.map((status) => {
              const column = orders.filter((o) => o.status === status);
              return (
                <Box key={status} sx={{ minWidth: 240, flex: 1, bgcolor: "action.hover", borderRadius: 1, p: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {WO_STATUS[status].label} ({column.length})
                  </Typography>
                  <Stack spacing={1}>
                    {column.map((o) => (
                      <WorkOrderCard key={o.id} order={o} />
                    ))}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        )}
      </QueryState>
      {creating && <NewWorkOrderDialog onClose={() => setCreating(false)} />}
    </Page>
  );
}
