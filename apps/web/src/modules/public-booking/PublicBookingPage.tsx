// apps/web/src/modules/public-booking/PublicBookingPage.tsx
// Capítulo 11.6 (Bible) — Agendamento online self-service. Página PÚBLICA
// (sem AppShell/autenticação), acessível em /agendar/:tenantSlug. Fluxo:
// serviço -> profissional -> data -> horário livre -> dados do cliente -> confirmar.
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import { publicBookingApi } from "./api";
import { errorMessage } from "../../shared/ui/PageLayout";

function todayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function PublicBookingPage() {
  const { tenantSlug = "" } = useParams<{ tenantSlug: string }>();
  const tenant = useQuery({ queryKey: ["public-booking-tenant", tenantSlug], queryFn: () => publicBookingApi.tenant(tenantSlug) });
  const services = useQuery({ queryKey: ["public-booking-services", tenantSlug], queryFn: () => publicBookingApi.services(tenantSlug) });
  const professionals = useQuery({
    queryKey: ["public-booking-professionals", tenantSlug],
    queryFn: () => publicBookingApi.professionals(tenantSlug),
  });

  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [date, setDate] = useState(todayISODate());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const slots = useQuery({
    queryKey: ["public-booking-slots", tenantSlug, serviceId, professionalId, date],
    queryFn: () => publicBookingApi.slots(tenantSlug, { serviceId, professionalId, date }),
    enabled: Boolean(serviceId && professionalId && date),
  });

  const book = useMutation({
    mutationFn: () =>
      publicBookingApi.createAppointment(tenantSlug, {
        serviceId,
        professionalId,
        scheduledAt: selectedSlot!,
        clientName,
        clientPhone,
      }),
    onSuccess: (data) => {
      setConfirmed(data.scheduledAt);
      setFormError(null);
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  if (tenant.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (tenant.isError || !tenant.data) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="error">Estabelecimento não encontrado. Confira o link de agendamento.</Alert>
      </Container>
    );
  }

  if (confirmed) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Card>
          <CardContent>
            <Stack spacing={2} alignItems="center" sx={{ py: 3 }}>
              <EventAvailableIcon color="success" sx={{ fontSize: 48 }} />
              <Typography variant="h6">Agendamento confirmado!</Typography>
              <Typography variant="body1">
                {new Date(confirmed).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tenant.data.name}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack spacing={1} sx={{ mb: 3 }} alignItems="center" textAlign="center">
        <Typography variant="h5">{tenant.data.name}</Typography>
        <Typography variant="body2" color="text.secondary">
          Agende seu horário online
        </Typography>
      </Stack>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField
              select
              label="Serviço"
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setSelectedSlot(null);
              }}
              disabled={services.isPending}
            >
              {(services.data ?? []).map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name} — R$ {Number(s.basePrice).toFixed(2)} ({s.estimatedDurationMinutes} min)
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Profissional"
              value={professionalId}
              onChange={(e) => {
                setProfessionalId(e.target.value);
                setSelectedSlot(null);
              }}
              disabled={professionals.isPending}
            >
              {(professionals.data ?? []).map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              type="date"
              label="Data"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSelectedSlot(null);
              }}
              InputLabelProps={{ shrink: true }}
            />

            {serviceId && professionalId && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Horários livres
                </Typography>
                {slots.isPending ? (
                  <CircularProgress size={20} />
                ) : slots.data && slots.data.length > 0 ? (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {slots.data.map((slot) => (
                      <Chip
                        key={slot}
                        label={new Date(slot).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        color={selectedSlot === slot ? "primary" : "default"}
                        onClick={() => setSelectedSlot(slot)}
                        clickable
                      />
                    ))}
                  </Stack>
                ) : (
                  <Alert severity="info">Nenhum horário livre para esta data. Tente outra data.</Alert>
                )}
              </Box>
            )}

            {selectedSlot && (
              <>
                <TextField label="Seu nome" value={clientName} onChange={(e) => setClientName(e.target.value)} required />
                <TextField label="Seu telefone (WhatsApp)" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} required />
                <Button
                  variant="contained"
                  size="large"
                  disabled={book.isPending || !clientName || clientPhone.length < 8}
                  onClick={() => book.mutate()}
                >
                  {book.isPending ? "Confirmando…" : "Confirmar agendamento"}
                </Button>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
