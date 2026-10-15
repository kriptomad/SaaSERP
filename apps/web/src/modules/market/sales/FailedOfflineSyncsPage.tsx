// apps/web/src/modules/market/sales/FailedOfflineSyncsPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — GAP DE AUDITORIA (rodada 3)
// fechado: antes desta página, uma venda registrada no PDV offline que falhasse ao
// sincronizar (estoque esgotado por outro terminal enquanto offline, série/variação
// inválida etc.) ficava visível SOMENTE no IndexedDB do navegador/terminal que a
// originou — nenhum gestor conseguia ver, num único lugar, todas as falhas de
// qualquer terminal do tenant. Consome GET/PATCH /sales/failed-offline-syncs.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../../shared/ui/PageLayout";
import { useToast } from "../../../shared/ui/Toast";
import { formatDateTime } from "../../../shared/ui/format";
import { salesApi, type FailedOfflineSaleSync } from "./api";

export function FailedOfflineSyncsPage() {
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");
  const [resolving, setResolving] = useState<FailedOfflineSaleSync | null>(null);
  const [note, setNote] = useState("");
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["failed-offline-syncs", statusFilter],
    queryFn: () => salesApi.listFailedOfflineSyncs(statusFilter),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, resolutionNote }: { id: string; resolutionNote: string }) =>
      salesApi.resolveFailedOfflineSync(id, resolutionNote),
    onSuccess: () => {
      toast.success("Reconciliação registrada.");
      setResolving(null);
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["failed-offline-syncs"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Page>
      <PageHeader
        title="Vendas offline não sincronizadas"
        subtitle="Vendas registradas no PDV offline (de qualquer terminal) que falharam ao sincronizar com o servidor e exigem reconciliação manual."
      />
      <Alert severity="warning" sx={{ mb: 2 }}>
        Estas vendas já foram apresentadas ao cliente como concluídas no terminal de origem, mas o estoque/série/variação
        não pôde ser confirmado no servidor (ex.: outro terminal vendeu o último item antes da sincronização). Revise cada
        caso manualmente — ajustando estoque, reembolsando o cliente ou reemitindo a venda — e marque como resolvido.
      </Alert>
      <Box sx={{ mb: 2 }}>
        <ToggleButtonGroup size="small" exclusive value={statusFilter} onChange={(_, v) => v && setStatusFilter(v)}>
          <ToggleButton value="pending">Pendentes</ToggleButton>
          <ToggleButton value="all">Todas</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma venda offline pendente de reconciliação.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Data</TableCell>
                  <TableCell>Caixa</TableCell>
                  <TableCell>Erro</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Ação</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                    <TableCell>{row.cashRegisterId}</TableCell>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Chip size="small" color="error" label={row.errorCode} />
                        <Typography variant="body2">{row.errorMessage}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {row.resolvedAt ? (
                        <Chip size="small" color="success" label={`Resolvido em ${formatDateTime(row.resolvedAt)}`} />
                      ) : (
                        <Chip size="small" color="warning" label="Pendente" />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {!row.resolvedAt && (
                        <Button size="small" variant="outlined" onClick={() => setResolving(row)}>
                          Reconciliar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>

      <Dialog open={Boolean(resolving)} onClose={() => setResolving(null)} fullWidth maxWidth="sm">
        <DialogTitle>Reconciliar venda offline</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {resolving?.errorMessage}
            </Typography>
            <TextField
              label="O que foi feito para reconciliar? (obrigatório)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              multiline
              minRows={3}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolving(null)}>Cancelar</Button>
          <Button
            variant="contained"
            disabled={note.trim().length < 3 || resolveMutation.isPending}
            onClick={() => resolving && resolveMutation.mutate({ id: resolving.id, resolutionNote: note.trim() })}
          >
            Confirmar reconciliação
          </Button>
        </DialogActions>
      </Dialog>
    </Page>
  );
}
