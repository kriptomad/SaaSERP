// apps/web/src/modules/personalization/PersonalizationOrdersPage.tsx
// Capítulo 11.5 — Papelaria/Presentes: personalização (bordado/sublimação) vinculada
// a um item de venda, com prazo de produção e aprovação de arte pelo cliente antes da
// confecção — reaproveita o mesmo ciclo de O.S. da Assistência Técnica.
//
// LIMITAÇÃO DOCUMENTADA: não existe nesta rodada um seletor de "item de venda" pronto
// no frontend (ex.: busca por venda/carrinho) — o campo "ID do item de venda" abaixo é
// um campo de texto simples que o operador preenche manualmente (ex.: copiado da tela
// de vendas/recibo). Um seletor dedicado fica como melhoria futura.
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
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
  personalizationApi,
  PERSONALIZATION_STATUS_LABEL,
  PERSONALIZATION_STATUS_ORDER,
  type PersonalizationWorkOrder,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { formatDateTime } from "../../shared/ui/format";

function nextStatus(current: string) {
  const idx = PERSONALIZATION_STATUS_ORDER.indexOf(current as (typeof PERSONALIZATION_STATUS_ORDER)[number]);
  if (idx === -1 || idx === PERSONALIZATION_STATUS_ORDER.length - 1) return null;
  return PERSONALIZATION_STATUS_ORDER[idx + 1];
}

function NewOrderForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [client, setClient] = useState<Client | null>(null);
  const [saleItemId, setSaleItemId] = useState("");
  const [description, setDescription] = useState("");
  const [productionDueAt, setProductionDueAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      personalizationApi.create({
        clientId: client!.id,
        saleItemId: saleItemId.trim(),
        description: description.trim(),
        productionDueAt: new Date(productionDueAt).toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["personalization-orders"] });
      toast.success("Ordem de personalização criada.");
      setSaleItemId("");
      setDescription("");
      setProductionDueAt("");
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!client) return setFormError("Selecione o cliente.");
    if (!saleItemId.trim()) return setFormError("Informe o ID do item de venda.");
    if (!description.trim()) return setFormError("Descreva a personalização (ex.: nome bordado, sublimação).");
    if (!productionDueAt) return setFormError("Informe o prazo de produção.");
    create.mutate();
  }

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Nova ordem de personalização
      </Typography>
      {formError && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {formError}
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} flexWrap="wrap" useFlexGap alignItems="flex-start">
        <ClientPicker value={client} onChange={setClient} label="Cliente" />
        <TextField
          label="ID do item de venda (SaleItem)"
          value={saleItemId}
          onChange={(e) => setSaleItemId(e.target.value)}
          sx={{ minWidth: 260 }}
          helperText="Copie o ID do item na tela de vendas/recibo."
        />
        <TextField
          label="Descrição da personalização"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          sx={{ minWidth: 260 }}
        />
        <TextField
          label="Prazo de produção"
          type="datetime-local"
          value={productionDueAt}
          onChange={(e) => setProductionDueAt(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 220 }}
        />
        <Button variant="contained" onClick={submit} disabled={create.isPending}>
          {create.isPending ? "Criando…" : "Criar ordem"}
        </Button>
      </Stack>
    </Paper>
  );
}

function OrderRow({ order }: { order: PersonalizationWorkOrder }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const item = order.items[0];
  const next = nextStatus(order.status);

  const approveArt = useMutation({
    mutationFn: () => personalizationApi.approveArt(item.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["personalization-orders"] });
      toast.success("Arte aprovada pelo cliente.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const advanceStatus = useMutation({
    mutationFn: () => personalizationApi.updateStatus(order.id, next!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["personalization-orders"] });
      toast.success("Status atualizado.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <TableRow hover>
      <TableCell>{order.client?.name ?? order.clientId}</TableCell>
      <TableCell>{order.reportedIssue}</TableCell>
      <TableCell>
        <Chip size="small" label={PERSONALIZATION_STATUS_LABEL[order.status]} color={order.status === "DELIVERED" ? "success" : "default"} />
      </TableCell>
      <TableCell>{item?.productionDueAt ? formatDateTime(item.productionDueAt) : "—"}</TableCell>
      <TableCell>
        {item?.artApprovedAt ? (
          <Chip size="small" color="success" label={`Aprovada em ${formatDateTime(item.artApprovedAt)}`} />
        ) : (
          <Button size="small" onClick={() => approveArt.mutate()} disabled={approveArt.isPending}>
            Aprovar arte
          </Button>
        )}
      </TableCell>
      <TableCell align="right">
        {next ? (
          <Button size="small" variant="outlined" onClick={() => advanceStatus.mutate()} disabled={advanceStatus.isPending}>
            Avançar para {PERSONALIZATION_STATUS_LABEL[next]}
          </Button>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
}

export function PersonalizationOrdersPage() {
  const orders = useQuery({ queryKey: ["personalization-orders"], queryFn: personalizationApi.list });

  return (
    <Page>
      <PageHeader
        title="Personalização (Bordado/Sublimação)"
        subtitle="O.S. de personalização vinculada a um item de venda, com prazo de produção e aprovação de arte do cliente."
      />
      <NewOrderForm />
      <QueryState query={orders} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma ordem de personalização cadastrada.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Cliente</TableCell>
                    <TableCell>Descrição</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Prazo de produção</TableCell>
                    <TableCell>Aprovação de arte</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((order) => (
                    <OrderRow key={order.id} order={order} />
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
