// apps/web/src/modules/stock/InventoryCountDetailPage.tsx
// Contagem cega: durante OPEN a API omite expectedQuantity. Ao entrar em RECONCILING
// pedimos revealExpected=true (exige permissão de escrita no estoque) para a revisão.
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
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useParams } from "react-router-dom";
import { countsApi, type InventoryCountItem } from "./api";
import { COUNT_STATUS } from "./InventoryCountsPage";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useToast } from "../../shared/ui/Toast";
import { formatDateTime, parseDecimal, qty, toNumber } from "../../shared/ui/format";

function CountItemRow({ countId, item, editable, showExpected }: { countId: string; item: InventoryCountItem; editable: boolean; showExpected: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [counted, setCounted] = useState(item.countedQuantity !== null ? String(Number(item.countedQuantity)) : "");
  const [reason, setReason] = useState(item.divergenceReason ?? "");
  const [rowError, setRowError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const countedQuantity = parseDecimal(counted);
      if (countedQuantity === null || countedQuantity < 0) throw new Error("Informe uma quantidade contada válida (≥ 0).");
      return countsApi.countItem(countId, item.id, { countedQuantity, ...(reason.trim() ? { divergenceReason: reason.trim() } : {}) });
    },
    onSuccess: () => {
      setRowError(null);
      toast.success(`${item.product.name}: contagem lançada.`);
      void queryClient.invalidateQueries({ queryKey: ["inventory-count", countId] });
    },
    onError: (error) => setRowError(errorMessage(error)),
  });

  const expected = item.expectedQuantity;
  const countedNumber = item.countedQuantity !== null ? toNumber(item.countedQuantity) : null;
  const divergence = expected !== undefined && countedNumber !== null ? countedNumber - toNumber(expected) : null;

  return (
    <TableRow hover>
      <TableCell>
        {item.product.name}
        {item.productBatch && <Chip size="small" label={`Lote ${item.productBatch.batchNumber}`} sx={{ ml: 1 }} />}
      </TableCell>
      {showExpected && <TableCell align="right">{expected !== undefined ? qty(expected) : "—"}</TableCell>}
      <TableCell sx={{ minWidth: 130 }}>
        {editable ? (
          <TextField size="small" value={counted} onChange={(e) => setCounted(e.target.value)} inputProps={{ "aria-label": `Contado ${item.product.name}` }} />
        ) : (
          qty(item.countedQuantity)
        )}
      </TableCell>
      {showExpected && (
        <TableCell align="right" sx={{ color: divergence ? "error.main" : undefined }}>
          {divergence === null ? "—" : qty(divergence)}
        </TableCell>
      )}
      <TableCell sx={{ minWidth: 220 }}>
        {editable ? (
          <TextField
            size="small"
            fullWidth
            placeholder="Motivo (se divergente)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={Boolean(rowError)}
            helperText={rowError ?? undefined}
          />
        ) : (
          (item.divergenceReason ?? "—")
        )}
      </TableCell>
      {editable && (
        <TableCell align="right">
          <Button size="small" variant="outlined" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {item.countedQuantity !== null ? "Atualizar" : "Lançar"}
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}

type PendingAction = "submit" | "approve" | "cancel" | null;

export function InventoryCountDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [onlyPending, setOnlyPending] = useState(false);
  const [action, setAction] = useState<PendingAction>(null);
  const rowsPerPage = 50;

  // O status só é conhecido após a primeira leitura; a segunda leitura (RECONCILING) revela o saldo teórico.
  const query = useQuery({
    queryKey: ["inventory-count", id],
    queryFn: async () => {
      const first = await countsApi.get(id, false);
      return first.status === "RECONCILING" ? countsApi.get(id, true) : first;
    },
    enabled: Boolean(id),
  });

  const transition = useMutation({
    mutationFn: (kind: Exclude<PendingAction, null>) =>
      kind === "submit" ? countsApi.submit(id) : kind === "approve" ? countsApi.approve(id) : countsApi.cancel(id),
    onSuccess: (_, kind) => {
      toast.success(
        kind === "submit" ? "Contagem enviada para aprovação." : kind === "approve" ? "Contagem aprovada — ajustes aplicados ao estoque." : "Contagem cancelada.",
      );
      void queryClient.invalidateQueries({ queryKey: ["inventory-count", id] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-counts"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      setAction(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setAction(null);
    },
  });

  const ACTION_COPY = {
    submit: { title: "Enviar para aprovação", message: "Todos os itens precisam estar contados. Após o envio não é possível alterar contagens.", label: "Enviar" },
    approve: { title: "Aprovar contagem", message: "As divergências serão aplicadas ao estoque como ajustes (StockMovement). Esta ação é irreversível.", label: "Aprovar e ajustar estoque" },
    cancel: { title: "Cancelar contagem", message: "Nenhum ajuste será aplicado ao estoque.", label: "Cancelar contagem" },
  } as const;

  return (
    <Page>
      <QueryState query={query}>
        {(count) => {
          const editable = count.status === "OPEN";
          const showExpected = count.items.some((i) => i.expectedQuantity !== undefined);
          const counted = count.items.filter((i) => i.countedQuantity !== null).length;
          const items = onlyPending ? count.items.filter((i) => i.countedQuantity === null) : count.items;
          return (
            <>
              <PageHeader
                title={`Contagem ${count.code}`}
                subtitle={`Iniciada em ${formatDateTime(count.startedAt)} · ${counted}/${count.items.length} itens contados`}
                actions={
                  <>
                    <Button component={RouterLink} to="/estoque/contagens">
                      Voltar
                    </Button>
                    {count.status === "OPEN" && (
                      <Button variant="contained" onClick={() => setAction("submit")}>
                        Enviar para aprovação
                      </Button>
                    )}
                    {count.status === "RECONCILING" && (
                      <Button variant="contained" onClick={() => setAction("approve")}>
                        Aprovar
                      </Button>
                    )}
                    {(count.status === "OPEN" || count.status === "RECONCILING") && (
                      <Button color="inherit" onClick={() => setAction("cancel")}>
                        Cancelar contagem
                      </Button>
                    )}
                  </>
                }
              />
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <Chip label={COUNT_STATUS[count.status]?.label ?? count.status} color={COUNT_STATUS[count.status]?.color ?? "default"} />
                {editable && (
                  <Chip
                    label="Somente não contados"
                    color={onlyPending ? "primary" : "default"}
                    onClick={() => {
                      setOnlyPending((v) => !v);
                      setPage(0);
                    }}
                  />
                )}
              </Stack>
              {count.notes && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {count.notes}
                </Typography>
              )}
              {count.status === "RECONCILING" && !showExpected && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Seu usuário não tem permissão para ver o saldo teórico; a aprovação exige permissão de escrita no estoque.
                </Alert>
              )}
              {items.length === 0 ? (
                <Alert severity="info">{count.items.length === 0 ? "Esta contagem não possui itens (nenhum produto ativo)." : "Todos os itens já foram contados."}</Alert>
              ) : (
                <Paper>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Produto</TableCell>
                          {showExpected && <TableCell align="right">Teórico</TableCell>}
                          <TableCell>Contado</TableCell>
                          {showExpected && <TableCell align="right">Divergência</TableCell>}
                          <TableCell>Motivo da divergência</TableCell>
                          {editable && <TableCell align="right">Ação</TableCell>}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {items.slice(page * rowsPerPage, (page + 1) * rowsPerPage).map((item) => (
                          <CountItemRow key={`${item.id}-${item.countedQuantity}`} countId={count.id} item={item} editable={editable} showExpected={showExpected} />
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <TablePagination
                    component="div"
                    count={items.length}
                    page={page}
                    onPageChange={(_, next) => setPage(next)}
                    rowsPerPage={rowsPerPage}
                    rowsPerPageOptions={[rowsPerPage]}
                    labelRowsPerPage="Linhas por página"
                  />
                </Paper>
              )}
            </>
          );
        }}
      </QueryState>
      <ConfirmDialog
        open={action !== null}
        title={action ? ACTION_COPY[action].title : ""}
        message={action ? ACTION_COPY[action].message : ""}
        confirmLabel={action ? ACTION_COPY[action].label : undefined}
        busy={transition.isPending}
        onConfirm={() => action && transition.mutate(action)}
        onClose={() => setAction(null)}
      />
    </Page>
  );
}
