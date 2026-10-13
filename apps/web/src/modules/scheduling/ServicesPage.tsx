// apps/web/src/modules/scheduling/ServicesPage.tsx
// CRUD de serviços. A API não tem DELETE: a "exclusão" é a desativação (active=false) via PATCH.
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NICHE_LABEL, schedulingApi, type NicheTag, type Service } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { money, parseDecimal } from "../../shared/ui/format";

function ServiceDialog({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(service?.name ?? "");
  const [nicheTag, setNicheTag] = useState<NicheTag>(service?.nicheTag ?? "PETSHOP");
  const [basePrice, setBasePrice] = useState(service ? String(Number(service.basePrice)) : "");
  const [duration, setDuration] = useState(service ? String(service.estimatedDurationMinutes) : "60");
  const [commission, setCommission] = useState(service ? String(Number(service.commissionPercentage)) : "0");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof schedulingApi.createService>[0]) =>
      service ? schedulingApi.updateService(service.id, input) : schedulingApi.createService(input),
    onSuccess: () => {
      toast.success("Serviço salvo.");
      void queryClient.invalidateQueries({ queryKey: ["services"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    const price = parseDecimal(basePrice);
    const minutes = parseDecimal(duration);
    const pct = parseDecimal(commission) ?? 0;
    if (!name.trim()) return setFormError("Informe o nome do serviço.");
    if (price === null || price <= 0) return setFormError("Preço base deve ser maior que zero.");
    if (!minutes || minutes < 1) return setFormError("Duração estimada deve ser de ao menos 1 minuto.");
    if (pct < 0 || pct > 100) return setFormError("Comissão deve estar entre 0 e 100%.");
    mutation.mutate({ name: name.trim(), nicheTag, basePrice: price, estimatedDurationMinutes: Math.round(minutes), commissionPercentage: pct });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{service ? "Editar serviço" : "Novo serviço"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField select label="Segmento" value={nicheTag} onChange={(e) => setNicheTag(e.target.value as NicheTag)}>
            {(Object.keys(NICHE_LABEL) as NicheTag[]).map((t) => (
              <MenuItem key={t} value={t}>
                {NICHE_LABEL[t]}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Preço base (R$)" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} required fullWidth />
            <TextField label="Duração (min)" value={duration} onChange={(e) => setDuration(e.target.value)} required fullWidth />
            <TextField label="Comissão (%)" value={commission} onChange={(e) => setCommission(e.target.value)} fullWidth />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ServicesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["services"], queryFn: schedulingApi.services });
  const [editing, setEditing] = useState<Service | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const toggle = useMutation({
    mutationFn: (s: Service) => schedulingApi.updateService(s.id, { active: !s.active }),
    onSuccess: (s) => {
      toast.success(s.active ? "Serviço reativado." : "Serviço desativado.");
      void queryClient.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Page>
      <PageHeader
        title="Serviços"
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Novo serviço
          </Button>
        }
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum serviço cadastrado.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Serviço</TableCell>
                  <TableCell>Segmento</TableCell>
                  <TableCell align="right">Preço</TableCell>
                  <TableCell align="right">Duração</TableCell>
                  <TableCell align="right">Comissão</TableCell>
                  <TableCell>Situação</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{NICHE_LABEL[s.nicheTag] ?? s.nicheTag}</TableCell>
                    <TableCell align="right">{money(s.basePrice)}</TableCell>
                    <TableCell align="right">{s.estimatedDurationMinutes} min</TableCell>
                    <TableCell align="right">{Number(s.commissionPercentage)}%</TableCell>
                    <TableCell>
                      <Chip size="small" label={s.active ? "Ativo" : "Inativo"} color={s.active ? "success" : "default"} />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Editar">
                        <IconButton
                          size="small"
                          aria-label={`Editar ${s.name}`}
                          onClick={() => {
                            setEditing(s);
                            setDialogOpen(true);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Button size="small" color="inherit" onClick={() => toggle.mutate(s)} disabled={toggle.isPending}>
                        {s.active ? "Desativar" : "Reativar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      {dialogOpen && <ServiceDialog key={editing?.id ?? "new"} service={editing} onClose={() => setDialogOpen(false)} />}
    </Page>
  );
}
