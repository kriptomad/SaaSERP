// apps/web/src/modules/stock/InventoryCountsPage.tsx
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import AddIcon from "@mui/icons-material/Add";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { countsApi, type CountStatus } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDateTime } from "../../shared/ui/format";

export const COUNT_STATUS: Record<CountStatus, { label: string; color: "info" | "warning" | "success" | "default" }> = {
  OPEN: { label: "Em contagem", color: "info" },
  RECONCILING: { label: "Aguardando aprovação", color: "warning" },
  APPROVED: { label: "Aprovada", color: "success" },
  CANCELLED: { label: "Cancelada", color: "default" },
};

function StartCountDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => countsApi.start({ scope: "FULL", ...(notes.trim() ? { notes: notes.trim() } : {}) }),
    onSuccess: (count) => {
      void queryClient.invalidateQueries({ queryKey: ["inventory-counts"] });
      toast.success(`Contagem ${count.code} iniciada.`);
      navigate(`/estoque/contagens/${count.id}`);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Iniciar contagem de estoque</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Alert severity="info">
            Escopo: todos os produtos ativos (FULL). A contagem é cega — o saldo teórico só é exibido na etapa de aprovação.
          </Alert>
          <TextField label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Iniciando…" : "Iniciar contagem"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function InventoryCountsPage() {
  const [status, setStatus] = useState("");
  const [starting, setStarting] = useState(false);
  const query = useQuery({ queryKey: ["inventory-counts", status], queryFn: () => countsApi.list(status || undefined) });

  return (
    <Page>
      <PageHeader
        title="Contagem de estoque"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setStarting(true)}>
            Nova contagem
          </Button>
        }
      />
      <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ mb: 2, minWidth: 220 }}>
        <MenuItem value="">Todos</MenuItem>
        {(Object.keys(COUNT_STATUS) as CountStatus[]).map((s) => (
          <MenuItem key={s} value={s}>
            {COUNT_STATUS[s].label}
          </MenuItem>
        ))}
      </TextField>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma contagem registrada.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Código</TableCell>
                  <TableCell>Escopo</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Início</TableCell>
                  <TableCell>Observações</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.code}</TableCell>
                    <TableCell>{c.scope}</TableCell>
                    <TableCell>
                      <Chip size="small" label={COUNT_STATUS[c.status]?.label ?? c.status} color={COUNT_STATUS[c.status]?.color ?? "default"} />
                    </TableCell>
                    <TableCell>{formatDateTime(c.startedAt)}</TableCell>
                    <TableCell>{c.notes ?? "—"}</TableCell>
                    <TableCell align="right">
                      <Button size="small" component={RouterLink} to={`/estoque/contagens/${c.id}`}>
                        {c.status === "OPEN" ? "Lançar contagem" : "Abrir"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      {starting && <StartCountDialog onClose={() => setStarting(false)} />}
    </Page>
  );
}
