// apps/web/src/modules/scheduling/ProfessionalScheduleSettingsPage.tsx
// Capítulo 11.6 (Bible) — configurações de agenda por profissional:
// (1) Expediente semanal (`ProfessionalWorkingHours`), base da Agenda Online
//     pública (/agendar/:tenantSlug) — sem expediente cadastrado, nenhum
//     horário aparece na página pública.
// (2) Relatório de comissões (`ServiceCommissionEntry`) — apenas leitura; os
//     registros só são criados no fechamento+pagamento da comanda.
import { useState } from "react";
import {
  Alert,
  Button,
  IconButton,
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
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { schedulingApi } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { useProfessionals } from "../../shared/lookups";
import { money, formatDateTime } from "../../shared/ui/format";

const WEEKDAY_LABEL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function WorkingHoursSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const professionals = useProfessionals();
  const [professionalId, setProfessionalId] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [formError, setFormError] = useState<string | null>(null);

  const entries = useQuery({
    queryKey: ["professional-working-hours", professionalId],
    queryFn: () => schedulingApi.workingHours(professionalId || undefined),
  });

  const save = useMutation({
    mutationFn: () =>
      schedulingApi.saveWorkingHours({ professionalId, dayOfWeek: Number(dayOfWeek), startTime, endTime }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["professional-working-hours"] });
      toast.success("Expediente salvo.");
      setFormError(null);
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => schedulingApi.deleteWorkingHours(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["professional-working-hours"] });
      toast.success("Expediente removido.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Expediente por profissional
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Base da Agenda Online pública: só aparecem horários livres para profissionais com expediente cadastrado no dia.
      </Typography>
      {formError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {formError}
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 2 }}>
        <TextField select label="Profissional" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} sx={{ minWidth: 200 }}>
          {(professionals.data ?? []).map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Dia da semana" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} sx={{ minWidth: 160 }}>
          {WEEKDAY_LABEL.map((label, idx) => (
            <MenuItem key={idx} value={String(idx)}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Início" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField label="Fim" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} InputLabelProps={{ shrink: true }} />
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={save.isPending}
          onClick={() => {
            setFormError(null);
            if (!professionalId) return setFormError("Selecione um profissional.");
            save.mutate();
          }}
        >
          Salvar
        </Button>
      </Stack>
      <QueryState query={entries} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum expediente cadastrado.">
        {(rows) => (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Profissional</TableCell>
                  <TableCell>Dia</TableCell>
                  <TableCell>Início</TableCell>
                  <TableCell>Fim</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>{professionals.data?.find((p) => p.id === r.professionalId)?.name ?? r.professionalId}</TableCell>
                    <TableCell>{WEEKDAY_LABEL[r.dayOfWeek]}</TableCell>
                    <TableCell>{r.startTime}</TableCell>
                    <TableCell>{r.endTime}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => remove.mutate(r.id)} disabled={remove.isPending}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
    </Paper>
  );
}

function CommissionReportSection() {
  const professionals = useProfessionals();
  const [professionalId, setProfessionalId] = useState("");

  const report = useQuery({
    queryKey: ["service-commissions", professionalId],
    queryFn: () => schedulingApi.serviceCommissions({ professionalId: professionalId || undefined }),
  });

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Comissões de serviço
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Liberadas apenas no fechamento e pagamento da comanda — nunca no agendamento.
      </Typography>
      <TextField
        select
        label="Profissional"
        value={professionalId}
        onChange={(e) => setProfessionalId(e.target.value)}
        sx={{ mb: 2, minWidth: 200 }}
      >
        <MenuItem value="">Todos</MenuItem>
        {(professionals.data ?? []).map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
          </MenuItem>
        ))}
      </TextField>
      <QueryState query={report} isEmpty={(d) => d.entries.length === 0} emptyMessage="Nenhuma comissão registrada.">
        {(data) => (
          <>
            <Typography variant="subtitle1" align="right" sx={{ mb: 1 }}>
              Total: {money(data.totalCommission)}
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Data</TableCell>
                    <TableCell>Profissional</TableCell>
                    <TableCell>Serviço</TableCell>
                    <TableCell align="right">Comissão</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.entries.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell>{formatDateTime(e.createdAt)}</TableCell>
                      <TableCell>{e.professional.name}</TableCell>
                      <TableCell>{e.service.name}</TableCell>
                      <TableCell align="right">{money(e.commissionAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </QueryState>
    </Paper>
  );
}

export function ProfessionalScheduleSettingsPage() {
  return (
    <Page>
      <PageHeader title="Configurações de agenda" subtitle="Expediente por profissional e relatório de comissões." />
      <WorkingHoursSection />
      <CommissionReportSection />
    </Page>
  );
}
