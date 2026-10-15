// apps/web/src/modules/construction/ConstructionQuotesPage.tsx
// Capítulo 11.8 — Material de Construção/Ferragens: orçamento de obra (múltiplos
// itens, validade configurável) com fluxo DRAFT→SENT→APPROVED→CONVERTED/REJECTED/EXPIRED.
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
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
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  constructionQuotesApi,
  CONSTRUCTION_QUOTE_STATUS_LABEL,
  type ConstructionQuoteStatus,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { formatDate, formatDateTime } from "../../shared/ui/format";

type DraftItem = { description: string; quantity: string; unit: string; unitPrice: string };

const STATUS_COLOR: Record<ConstructionQuoteStatus, "default" | "info" | "warning" | "success" | "error"> = {
  DRAFT: "default",
  SENT: "info",
  APPROVED: "success",
  REJECTED: "error",
  CONVERTED: "success",
  EXPIRED: "warning",
};

const NEXT_STATUS: Record<ConstructionQuoteStatus, ConstructionQuoteStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["CONVERTED", "EXPIRED"],
  REJECTED: [],
  CONVERTED: [],
  EXPIRED: [],
};

function NewQuoteForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [client, setClient] = useState<Client | null>(null);
  const [title, setTitle] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [items, setItems] = useState<DraftItem[]>([{ description: "", quantity: "1", unit: "un", unitPrice: "0" }]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      constructionQuotesApi.create({
        clientId: client!.id,
        title: title.trim(),
        validUntil: validUntil || null,
        items: items.map((i) => ({ description: i.description.trim(), quantity: Number(i.quantity) || 0, unit: i.unit.trim(), unitPrice: Number(i.unitPrice) || 0 })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["construction-quotes"] });
      toast.success("Orçamento de obra criado.");
      setClient(null);
      setTitle("");
      setValidUntil("");
      setItems([{ description: "", quantity: "1", unit: "un", unitPrice: "0" }]);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const total = items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const valid = Boolean(client) && title.trim().length > 0 && items.every((i) => i.description.trim() && Number(i.quantity) > 0 && i.unit.trim());

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Novo orçamento de obra
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <ClientPicker value={client} onChange={setClient} label="Cliente" required />
          <TextField label="Título da obra" value={title} onChange={(e) => setTitle(e.target.value)} sx={{ minWidth: 240 }} required />
          <TextField
            label="Válido até"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 180 }}
          />
        </Stack>
        <Stack spacing={1}>
          {items.map((item, idx) => (
            <Stack key={idx} direction="row" spacing={1} alignItems="center">
              <TextField
                label="Material/serviço"
                value={item.description}
                onChange={(e) => setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
                sx={{ flex: 2 }}
              />
              <TextField
                label="Qtd"
                type="number"
                value={item.quantity}
                onChange={(e) => setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))}
                sx={{ width: 90 }}
              />
              <TextField
                label="Unidade"
                value={item.unit}
                onChange={(e) => setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                sx={{ width: 110 }}
                helperText="m², saco, barra…"
              />
              <TextField
                label="Preço unit. (R$)"
                type="number"
                value={item.unitPrice}
                onChange={(e) => setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, unitPrice: e.target.value } : x)))}
                sx={{ width: 140 }}
              />
              <IconButton disabled={items.length === 1} onClick={() => setItems((arr) => arr.filter((_, i) => i !== idx))}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Button
            startIcon={<AddIcon />}
            size="small"
            sx={{ alignSelf: "flex-start" }}
            onClick={() => setItems((arr) => [...arr, { description: "", quantity: "1", unit: "un", unitPrice: "0" }])}
          >
            Adicionar item
          </Button>
        </Stack>
        <Typography variant="body2">Total estimado: R$ {total.toFixed(2)}</Typography>
        <Button
          variant="contained"
          disabled={!valid || create.isPending}
          onClick={() => {
            setError(null);
            create.mutate();
          }}
          sx={{ alignSelf: "flex-start" }}
        >
          {create.isPending ? "Criando…" : "Criar orçamento"}
        </Button>
      </Stack>
    </Paper>
  );
}

function StatusActions({ id, status }: { id: string; status: ConstructionQuoteStatus }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (next: ConstructionQuoteStatus) => constructionQuotesApi.setStatus(id, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["construction-quotes"] });
      toast.success("Status atualizado.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const next = NEXT_STATUS[status];
  if (next.length === 0) return null;
  return (
    <Stack direction="row" spacing={1}>
      {next.map((s) => (
        <Button key={s} size="small" disabled={mutation.isPending} onClick={() => mutation.mutate(s)}>
          {CONSTRUCTION_QUOTE_STATUS_LABEL[s]}
        </Button>
      ))}
    </Stack>
  );
}

export function ConstructionQuotesPage() {
  const [statusFilter, setStatusFilter] = useState<ConstructionQuoteStatus | "">("");
  const query = useQuery({ queryKey: ["construction-quotes", statusFilter], queryFn: () => constructionQuotesApi.list(statusFilter || undefined) });

  return (
    <Page>
      <PageHeader
        title="Orçamentos de Obra"
        subtitle="Orçamento multi-item para construtoras/empreiteiros — a venda real é lançada no PDV referenciando este orçamento."
        actions={
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ConstructionQuoteStatus | "")} sx={{ minWidth: 200 }}>
            <MenuItem value="">Todos</MenuItem>
            {(Object.keys(CONSTRUCTION_QUOTE_STATUS_LABEL) as ConstructionQuoteStatus[]).map((s) => (
              <MenuItem key={s} value={s}>
                {CONSTRUCTION_QUOTE_STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      <Stack spacing={2}>
        <NewQuoteForm />
        <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum orçamento de obra encontrado.">
          {(data) => (
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cliente</TableCell>
                      <TableCell>Título</TableCell>
                      <TableCell align="right">Itens</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell>Válido até</TableCell>
                      <TableCell>Criado em</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Ações</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.map((q) => {
                      const total = q.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
                      return (
                        <TableRow key={q.id} hover>
                          <TableCell>{q.client.name}</TableCell>
                          <TableCell>{q.title}</TableCell>
                          <TableCell align="right">{q.items.length}</TableCell>
                          <TableCell align="right">R$ {total.toFixed(2)}</TableCell>
                          <TableCell>{q.validUntil ? formatDate(q.validUntil) : "—"}</TableCell>
                          <TableCell>{formatDateTime(q.createdAt)}</TableCell>
                          <TableCell>
                            <Chip size="small" label={CONSTRUCTION_QUOTE_STATUS_LABEL[q.status]} color={STATUS_COLOR[q.status]} />
                          </TableCell>
                          <TableCell align="right">
                            <StatusActions id={q.id} status={q.status} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
