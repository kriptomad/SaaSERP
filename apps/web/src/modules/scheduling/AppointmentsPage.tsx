// apps/web/src/modules/scheduling/AppointmentsPage.tsx
// Agenda em lista agrupada por dia (visão Dia ou Semana). Sem grade horária/drag-and-drop.
import { useMemo, useState } from "react";
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
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { APPOINTMENT_STATUS, schedulingApi, type Appointment, type AppointmentStatus } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ClientPicker, useProfessionals } from "../../shared/lookups";
import { useToast } from "../../shared/ui/Toast";
import { money, parseDecimal, toDateTimeLocalInput } from "../../shared/ui/format";
import type { Client } from "../registrations/api";

type View = "day" | "week";

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function NewAppointmentDialog({ defaultDate, onClose }: { defaultDate: Date; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const services = useQuery({ queryKey: ["services"], queryFn: schedulingApi.services });
  const professionals = useProfessionals();
  const [client, setClient] = useState<Client | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const initial = new Date(defaultDate);
  initial.setHours(9, 0, 0, 0);
  const [when, setWhen] = useState(toDateTimeLocalInput(initial));
  const [duration, setDuration] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const activeServices = (services.data ?? []).filter((s) => s.active);

  const mutation = useMutation({
    mutationFn: schedulingApi.createAppointment,
    onSuccess: () => {
      toast.success("Agendamento criado.");
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!client) return setFormError("Selecione o cliente.");
    if (!serviceId) return setFormError("Selecione o serviço.");
    if (!professionalId) return setFormError("Selecione o profissional.");
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) return setFormError("Informe data e hora válidas.");
    const minutes = parseDecimal(duration);
    mutation.mutate({
      clientId: client.id,
      serviceId,
      professionalId,
      scheduledAt: date.toISOString(),
      ...(minutes && minutes > 0 ? { durationMinutes: Math.round(minutes) } : {}),
    });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo agendamento</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <ClientPicker value={client} onChange={setClient} required />
          <TextField
            select
            required
            label="Serviço"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            error={services.isError}
            helperText={services.isError ? errorMessage(services.error) : activeServices.length === 0 && !services.isPending ? "Cadastre um serviço em Agenda › Serviços." : undefined}
          >
            {activeServices.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name} — {money(s.basePrice)} ({s.estimatedDurationMinutes} min)
              </MenuItem>
            ))}
          </TextField>
          <TextField select required label="Profissional" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
            {(professionals.data ?? []).map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Data e hora"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              InputLabelProps={{ shrink: true }}
              required
              fullWidth
            />
            <TextField label="Duração (min, opcional)" value={duration} onChange={(e) => setDuration(e.target.value)} fullWidth />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? "Salvando…" : "Agendar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AppointmentRow({ appointment }: { appointment: Appointment }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (status: AppointmentStatus) => schedulingApi.setStatus(appointment.id, status),
    onSuccess: () => {
      toast.success("Status atualizado.");
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const start = new Date(appointment.scheduledAt);
  const end = new Date(start.getTime() + appointment.durationMinutes * 60_000);
  const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
      <Typography sx={{ minWidth: 110 }} variant="subtitle2">
        {hhmm(start)} – {hhmm(end)}
      </Typography>
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2">
          {appointment.client?.name} — {appointment.service?.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Profissional: {appointment.professional?.name}
        </Typography>
      </Box>
      <Chip size="small" label={APPOINTMENT_STATUS[appointment.status].label} color={APPOINTMENT_STATUS[appointment.status].color} />
      <Select
        size="small"
        value={appointment.status}
        onChange={(e) => mutation.mutate(e.target.value as AppointmentStatus)}
        disabled={mutation.isPending}
        inputProps={{ "aria-label": "Alterar status" }}
        sx={{ minWidth: 170 }}
      >
        {(Object.keys(APPOINTMENT_STATUS) as AppointmentStatus[]).map((s) => (
          <MenuItem key={s} value={s}>
            {APPOINTMENT_STATUS[s].label}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  );
}

export function AppointmentsPage() {
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [creating, setCreating] = useState(false);

  const range = useMemo(() => {
    const from = view === "day" ? startOfDay(anchor) : startOfWeek(anchor);
    const to = addDays(from, view === "day" ? 1 : 7);
    to.setMilliseconds(-1);
    return { from, to };
  }, [view, anchor]);

  const query = useQuery({
    queryKey: ["appointments", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => schedulingApi.appointments({ from: range.from.toISOString(), to: range.to.toISOString() }),
  });

  const step = view === "day" ? 1 : 7;
  const label =
    view === "day"
      ? range.from.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
      : `${range.from.toLocaleDateString("pt-BR")} – ${range.to.toLocaleDateString("pt-BR")}`;

  const days = Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => addDays(range.from, i));

  return (
    <Page maxWidth={1000}>
      <PageHeader
        title="Agenda"
        actions={
          <>
            <Button component={RouterLink} to="/agenda/servicos" variant="outlined">
              Serviços
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
              Novo agendamento
            </Button>
          </>
        }
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} sx={{ mb: 2 }}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: View | null) => v && setView(v)}>
          <ToggleButton value="day">Dia</ToggleButton>
          <ToggleButton value="week">Semana</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction="row" alignItems="center">
          <IconButton aria-label="Anterior" onClick={() => setAnchor((a) => addDays(a, -step))}>
            <ChevronLeftIcon />
          </IconButton>
          <Button onClick={() => setAnchor(startOfDay(new Date()))}>Hoje</Button>
          <IconButton aria-label="Próximo" onClick={() => setAnchor((a) => addDays(a, step))}>
            <ChevronRightIcon />
          </IconButton>
        </Stack>
        <Typography variant="subtitle1" sx={{ textTransform: "capitalize" }}>
          {label}
        </Typography>
      </Stack>
      <QueryState query={query}>
        {(appointments) => {
          if (appointments.length === 0) return <Alert severity="info">Nenhum agendamento no período.</Alert>;
          return (
            <Stack spacing={2}>
              {days.map((day) => {
                const items = appointments.filter((a) => startOfDay(new Date(a.scheduledAt)).getTime() === day.getTime());
                if (items.length === 0) return null;
                return (
                  <Paper key={day.toISOString()} sx={{ p: 2 }}>
                    <Typography variant="subtitle2" sx={{ textTransform: "capitalize", mb: 1 }}>
                      {day.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })} ({items.length})
                    </Typography>
                    {items.map((a) => (
                      <AppointmentRow key={a.id} appointment={a} />
                    ))}
                  </Paper>
                );
              })}
            </Stack>
          );
        }}
      </QueryState>
      {creating && <NewAppointmentDialog defaultDate={anchor} onClose={() => setCreating(false)} />}
    </Page>
  );
}
