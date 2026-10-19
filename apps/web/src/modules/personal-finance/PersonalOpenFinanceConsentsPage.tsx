// apps/web/src/modules/personal-finance/PersonalOpenFinanceConsentsPage.tsx
// Capítulo 22.5 — consentimentos de Open Finance (agregador Pluggy). O widget de
// conexão bancária em si (iframe/SDK do agregador) é um componente de terceiro cujo
// embed real depende de credenciais de produção do agregador — PENDENTE nesta
// rodada (ver observação abaixo); esta tela cobre o ciclo de vida do consentimento
// já retornado pelo agregador (criar o registro após o login no widget, sincronizar,
// revogar), que é 100% do contrato real exposto por personal-planning.routes.ts.
import { useState } from "react";
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, IconButton, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SyncIcon from "@mui/icons-material/Sync";
import DeleteIcon from "@mui/icons-material/Delete";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useToast } from "../../shared/ui/Toast";
import { dateInputToIso, formatDateTime, toDateInput } from "../../shared/ui/format";
import { OPEN_FINANCE_STATUS_LABEL, personalFinanceApi, type OpenFinanceConsent } from "./api";

function CreateConsentDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [itemId, setItemId] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [consentExpiresAt, setConsentExpiresAt] = useState(toDateInput(new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)));
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => personalFinanceApi.createOpenFinanceConsent(body),
    onSuccess: () => {
      toast.success("Consentimento registrado.");
      void queryClient.invalidateQueries({ queryKey: ["personal-open-finance-consents"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!itemId.trim()) return setFormError("Informe o itemId retornado pelo widget do agregador.");
    if (!institutionName.trim()) return setFormError("Informe o nome da instituição.");
    if (!consentExpiresAt) return setFormError("Informe a validade do consentimento.");
    mutation.mutate({ itemId: itemId.trim(), institutionName: institutionName.trim(), consentExpiresAt: dateInputToIso(consentExpiresAt) });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo consentimento Open Finance</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Alert severity="info">
            O Filitech nunca recebe nem armazena suas credenciais bancárias. Conecte sua conta pelo widget do agregador (Pluggy) e
            informe abaixo o <b>itemId</b> e a instituição retornados ao final do fluxo.
          </Alert>
          <TextField label="Instituição" value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} required autoFocus />
          <TextField label="itemId (retornado pelo widget)" value={itemId} onChange={(e) => setItemId(e.target.value)} required />
          <TextField
            label="Consentimento válido até"
            type="date"
            value={consentExpiresAt}
            onChange={(e) => setConsentExpiresAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
            required
          />
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

export function PersonalOpenFinanceConsentsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["personal-open-finance-consents"], queryFn: () => personalFinanceApi.openFinanceConsents(), staleTime: 60_000 });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<OpenFinanceConsent | null>(null);

  const sync = useMutation({
    mutationFn: (id: string) => personalFinanceApi.syncOpenFinanceConsent(id),
    onSuccess: () => toast.success("Sincronização solicitada — pode levar alguns minutos para concluir."),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => personalFinanceApi.deleteOpenFinanceConsent(id),
    onSuccess: () => {
      toast.success("Consentimento revogado.");
      void queryClient.invalidateQueries({ queryKey: ["personal-open-finance-consents"] });
      setDeleting(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleting(null);
    },
  });

  return (
    <Page>
      <PageHeader title="Open Finance" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Conectar conta</Button>} />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma instituição conectada ainda.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Instituição</TableCell>
                  <TableCell>Situação</TableCell>
                  <TableCell>Última sincronização</TableCell>
                  <TableCell>Consentimento expira em</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.institutionName}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={OPEN_FINANCE_STATUS_LABEL[c.status]}
                        color={c.status === "UPDATED" ? "success" : c.status === "LOGIN_ERROR" ? "error" : "warning"}
                      />
                    </TableCell>
                    <TableCell>{formatDateTime(c.lastSyncedAt)}</TableCell>
                    <TableCell>{formatDateTime(c.consentExpiresAt)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Sincronizar agora">
                        <IconButton size="small" onClick={() => sync.mutate(c.id)} disabled={sync.isPending} aria-label={`Sincronizar ${c.institutionName}`}>
                          <SyncIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Revogar">
                        <IconButton size="small" onClick={() => setDeleting(c)} aria-label={`Revogar ${c.institutionName}`}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        PENDENTE (documentado também no backend): o embed do widget de conexão bancária do agregador (iframe/SDK oficial da Pluggy)
        depende de credenciais de produção e não foi incluído nesta rodada — o fluxo acima cobre o ciclo de vida do consentimento já
        retornado pelo agregador após o login do usuário.
      </Typography>
      {creating && <CreateConsentDialog onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Revogar consentimento"
        message={`A conexão com ${deleting?.institutionName} será revogada e nenhuma nova sincronização ocorrerá.`}
        confirmLabel="Revogar"
        busy={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </Page>
  );
}
