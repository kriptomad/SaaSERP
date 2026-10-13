// apps/web/src/modules/seasonality/SeasonalityWindowsPage.tsx
// Capítulo 11.5 — Papelaria/Presentes: cadastro de janelas de sazonalidade (ex.:
// "Volta às Aulas" out-fev, "Natal" out-dez) associadas a uma categoria de produto —
// usadas para ajustar automaticamente a sugestão de compra (ver reorder-suggestions)
// e para alimentar o relatório de liquidação de sobras (SeasonalClearanceReportPage).
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  Switch,
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
import { seasonalityApi, type SeasonalityWindow } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";

const MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function monthDayLabel(month: number, day: number): string {
  return `${String(day).padStart(2, "0")}/${MONTHS[month - 1]}`;
}

function emptyForm() {
  return { name: "", category: "", startMonth: "10", startDay: "1", endMonth: "2", endDay: "28" };
}

export function SeasonalityWindowsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const windows = useQuery({ queryKey: ["seasonality-windows"], queryFn: seasonalityApi.list });

  const upsert = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        startMonth: Number(form.startMonth),
        startDay: Number(form.startDay),
        endMonth: Number(form.endMonth),
        endDay: Number(form.endDay),
      };
      return editingId ? seasonalityApi.update(editingId, payload) : seasonalityApi.create(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["seasonality-windows"] });
      toast.success(editingId ? "Janela de sazonalidade atualizada." : "Janela de sazonalidade cadastrada.");
      setForm(emptyForm());
      setEditingId(null);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const toggleActive = useMutation({
    mutationFn: (w: SeasonalityWindow) => seasonalityApi.update(w.id, { active: !w.active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["seasonality-windows"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!form.name.trim()) return setFormError("Informe o nome da janela (ex.: Volta às Aulas).");
    if (!form.category.trim()) return setFormError("Informe a categoria do produto associada.");
    upsert.mutate();
  }

  function startEdit(w: SeasonalityWindow) {
    setEditingId(w.id);
    setForm({
      name: w.name,
      category: w.category,
      startMonth: String(w.startMonth),
      startDay: String(w.startDay),
      endMonth: String(w.endMonth),
      endDay: String(w.endDay),
    });
  }

  return (
    <Page>
      <PageHeader
        title="Sazonalidade Planejada"
        subtitle="Janelas de pico por categoria (ex.: Volta às Aulas, Natal) — antecipam a sugestão de compra e alimentam o relatório de liquidação de sobras."
      />

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          {editingId ? "Editar janela" : "Nova janela de sazonalidade"}
        </Typography>
        {formError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {formError}
          </Alert>
        )}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} sx={{ minWidth: 200 }} />
          <TextField
            label="Categoria do produto"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            sx={{ minWidth: 200 }}
          />
          <TextField
            select
            label="Mês início"
            value={form.startMonth}
            onChange={(e) => setForm({ ...form, startMonth: e.target.value })}
            sx={{ minWidth: 110 }}
          >
            {MONTHS.map((m, idx) => (
              <MenuItem key={m} value={String(idx + 1)}>
                {m}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Dia início" value={form.startDay} onChange={(e) => setForm({ ...form, startDay: e.target.value })} sx={{ minWidth: 100 }} />
          <TextField
            select
            label="Mês fim"
            value={form.endMonth}
            onChange={(e) => setForm({ ...form, endMonth: e.target.value })}
            sx={{ minWidth: 110 }}
          >
            {MONTHS.map((m, idx) => (
              <MenuItem key={m} value={String(idx + 1)}>
                {m}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Dia fim" value={form.endDay} onChange={(e) => setForm({ ...form, endDay: e.target.value })} sx={{ minWidth: 100 }} />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={submit} disabled={upsert.isPending}>
              {upsert.isPending ? "Salvando…" : editingId ? "Salvar edição" : "Cadastrar"}
            </Button>
            {editingId && (
              <Button
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm());
                }}
              >
                Cancelar
              </Button>
            )}
          </Stack>
        </Stack>
      </Paper>

      <QueryState query={windows} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma janela de sazonalidade cadastrada.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nome</TableCell>
                    <TableCell>Categoria</TableCell>
                    <TableCell>Início</TableCell>
                    <TableCell>Fim</TableCell>
                    <TableCell>Ativa</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((w) => (
                    <TableRow key={w.id} hover>
                      <TableCell>{w.name}</TableCell>
                      <TableCell>
                        <Chip size="small" label={w.category} />
                      </TableCell>
                      <TableCell>{monthDayLabel(w.startMonth, w.startDay)}</TableCell>
                      <TableCell>{monthDayLabel(w.endMonth, w.endDay)}</TableCell>
                      <TableCell>
                        <Switch checked={w.active} onChange={() => toggleActive.mutate(w)} size="small" />
                      </TableCell>
                      <TableCell align="right">
                        <Button size="small" onClick={() => startEdit(w)}>
                          Editar
                        </Button>
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
