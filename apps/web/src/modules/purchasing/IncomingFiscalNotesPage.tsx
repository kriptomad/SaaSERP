// apps/web/src/modules/purchasing/IncomingFiscalNotesPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.19.4 — Manifestação do Destinatário.
// GAP DE AUDITORIA FECHADO (mega-audit rodada 9): tela nova para
// `/fiscal/notas-recebidas` — sem ela o lojista não enxergava o status da
// manifestação de cada NF-e de compra recebida nem conseguia se manifestar
// manualmente quando a confirmação automática (no recebimento de mercadoria) falhava
// ou quando a nota foi emitida indevidamente em seu CNPJ (operação não realizada /
// desconhecimento da operação).
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
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import {
  incomingFiscalNotesApi,
  type IncomingFiscalNote,
  type ManualManifestInput,
  type RecipientManifestationType,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, money } from "../../shared/ui/format";

const MANIFESTATION_LABEL: Record<RecipientManifestationType, string> = {
  CIENCIA_DA_OPERACAO: "Ciência da operação",
  CONFIRMACAO_DA_OPERACAO: "Confirmação da operação",
  OPERACAO_NAO_REALIZADA: "Operação não realizada",
  DESCONHECIMENTO_DA_OPERACAO: "Desconhecimento da operação",
};

const STATUS_COLOR: Record<"PENDING" | "AUTHORIZED" | "REJECTED", "default" | "warning" | "success" | "error"> = {
  PENDING: "warning",
  AUTHORIZED: "success",
  REJECTED: "error",
};

function manifestationChip(note: IncomingFiscalNote) {
  if (!note.lastManifestation) {
    return <Chip size="small" color="default" label="Sem manifestação" />;
  }
  const { type, status } = note.lastManifestation;
  return <Chip size="small" color={STATUS_COLOR[status]} label={`${MANIFESTATION_LABEL[type]} (${status})`} />;
}

export function IncomingFiscalNotesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["incoming-fiscal-notes"], queryFn: incomingFiscalNotesApi.list });
  const [manifestTarget, setManifestTarget] = useState<IncomingFiscalNote | null>(null);
  const [manifestationType, setManifestationType] = useState<ManualManifestInput["manifestationType"]>("OPERACAO_NAO_REALIZADA");
  const [justification, setJustification] = useState("");

  const manifestMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ManualManifestInput }) => incomingFiscalNotesApi.manifest(id, input),
    onSuccess: () => {
      toast.success("Manifestação registrada junto à SEFAZ.");
      void queryClient.invalidateQueries({ queryKey: ["incoming-fiscal-notes"] });
      setManifestTarget(null);
      setJustification("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const justificationTooShort = manifestationType === "OPERACAO_NAO_REALIZADA" && justification.trim().length < 15;

  return (
    <Page>
      <PageHeader
        title="Notas fiscais recebidas"
        subtitle="NF-e de compra capturadas via Distribuição DFe — manifeste-se manualmente quando a confirmação automática falhar ou a nota não for sua."
      />
      <QueryState query={query}>
        {(notes) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Emitente</TableCell>
                  <TableCell>Chave de acesso</TableCell>
                  <TableCell align="right">Valor total</TableCell>
                  <TableCell>Emitida em</TableCell>
                  <TableCell>Pedido de compra</TableCell>
                  <TableCell>Última manifestação</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {notes.map((note) => (
                  <TableRow key={note.id} hover>
                    <TableCell>
                      {note.emitterName}
                      <Typography variant="caption" display="block" color="text.secondary">
                        {note.emitterCnpj}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                        {note.accessKey}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{money(Number(note.totalAmount))}</TableCell>
                    <TableCell>{formatDate(note.authorizedAt)}</TableCell>
                    <TableCell>
                      {note.purchaseOrder ? (
                        <Button component={RouterLink} to={`/compras/${note.purchaseOrder.id}`} size="small">
                          #{note.purchaseOrder.orderNumber}
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{manifestationChip(note)}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        disabled={note.lastManifestation?.type === "CONFIRMACAO_DA_OPERACAO" && note.lastManifestation.status === "AUTHORIZED"}
                        onClick={() => {
                          setManifestTarget(note);
                          setManifestationType("OPERACAO_NAO_REALIZADA");
                          setJustification("");
                        }}
                      >
                        Manifestar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {notes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography color="text.secondary" align="center" sx={{ py: 3 }}>
                        Nenhuma nota fiscal de compra recebida até o momento.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>

      <Dialog open={Boolean(manifestTarget)} onClose={() => setManifestTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Manifestação manual do destinatário</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              Use "Operação não realizada" quando a mercadoria não foi efetivamente recebida, ou "Desconhecimento da
              operação" quando a nota foi emitida indevidamente em seu CNPJ. Ambas são decisões DEFINITIVAS perante a
              SEFAZ — não é possível manifestar-se novamente sobre a mesma nota depois.
            </Alert>
            <TextField
              select
              label="Tipo de manifestação"
              value={manifestationType}
              onChange={(e) => setManifestationType(e.target.value as ManualManifestInput["manifestationType"])}
            >
              <MenuItem value="OPERACAO_NAO_REALIZADA">Operação não realizada</MenuItem>
              <MenuItem value="DESCONHECIMENTO_DA_OPERACAO">Desconhecimento da operação</MenuItem>
            </TextField>
            {manifestationType === "OPERACAO_NAO_REALIZADA" && (
              <TextField
                label="Justificativa (mínimo 15 caracteres)"
                multiline
                minRows={3}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                error={justificationTooShort && justification.length > 0}
                helperText={`${justification.trim().length}/15 caracteres mínimos`}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManifestTarget(null)}>Cancelar</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={!manifestTarget || justificationTooShort || manifestMutation.isPending}
            onClick={() =>
              manifestTarget &&
              manifestMutation.mutate({
                id: manifestTarget.id,
                input: { manifestationType, justification: manifestationType === "OPERACAO_NAO_REALIZADA" ? justification.trim() : undefined },
              })
            }
          >
            {manifestMutation.isPending ? "Enviando..." : "Confirmar manifestação"}
          </Button>
        </DialogActions>
      </Dialog>
    </Page>
  );
}
