// apps/web/src/modules/accounting-office/AccountingOfficePage.tsx
// Gestão de vínculo contábil (procuração eletrônica interna) do ponto de vista
// do tenant-cliente: conceder/aceitar/revogar AccountingEngagement, ver tarefas
// recorrentes e documentos oficiais já emitidos. Não há marketplace de busca
// pública ainda (Capítulo 21.18.6 PENDENTE) — o tenant do escritório é
// informado manualmente pelo ID.
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
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import BlockIcon from "@mui/icons-material/Block";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  accountingOfficeApi,
  ENGAGEMENT_SCOPE_LABEL,
  ENGAGEMENT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  type AccountingEngagementScope,
  type AccountingTaskStatus,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { formatDate, formatDateTime } from "../../shared/ui/format";

const ALL_SCOPES = Object.keys(ENGAGEMENT_SCOPE_LABEL) as AccountingEngagementScope[];

function GrantEngagementDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [firmTenantId, setFirmTenantId] = useState("");
  const [scopes, setScopes] = useState<AccountingEngagementScope[]>([]);
  const [error, setError] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: () => accountingOfficeApi.grantEngagement({ accountingFirmTenantId: firmTenantId.trim(), scopes }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounting-engagements"] });
      toast.success("Vínculo criado. Aguardando aceite do escritório contábil.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Contratar / autorizar escritório contábil</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="ID do tenant do escritório contábil"
            value={firmTenantId}
            onChange={(e) => setFirmTenantId(e.target.value)}
            required
            autoFocus
            helperText="Peça ao seu contador o ID do tenant dele no Filitech ERP."
          />
          <Typography variant="subtitle2">Escopos autorizados</Typography>
          <Select
            multiple
            value={scopes}
            onChange={(e) => setScopes(e.target.value as AccountingEngagementScope[])}
            renderValue={(selected) => (selected as string[]).map((s) => ENGAGEMENT_SCOPE_LABEL[s as AccountingEngagementScope]).join(", ")}
          >
            {ALL_SCOPES.map((s) => (
              <MenuItem key={s} value={s}>
                {ENGAGEMENT_SCOPE_LABEL[s]}
              </MenuItem>
            ))}
          </Select>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={grant.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={grant.isPending}
          onClick={() => {
            setError(null);
            if (!firmTenantId.trim()) return setError("Informe o ID do tenant do escritório.");
            if (scopes.length === 0) return setError("Selecione ao menos um escopo.");
            grant.mutate();
          }}
        >
          {grant.isPending ? "Enviando…" : "Enviar convite"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EngagementsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["accounting-engagements"], queryFn: accountingOfficeApi.listEngagements });
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: (id: string) => accountingOfficeApi.acceptEngagement(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounting-engagements"] });
      toast.success("Vínculo aceito.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => accountingOfficeApi.revokeEngagement(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounting-engagements"] });
      toast.success("Vínculo revogado.");
      setRevokeId(null);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setRevokeId(null);
    },
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setGrantOpen(true)}>
          Contratar / autorizar contador
        </Button>
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum vínculo contábil registrado ainda.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Escritório (tenant)</TableCell>
                    <TableCell>Escopos</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Concedido em</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell>{e.accountingFirmTenantId}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {e.scopes.map((s) => (
                            <Chip key={s} size="small" label={ENGAGEMENT_SCOPE_LABEL[s]} />
                          ))}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={ENGAGEMENT_STATUS_LABEL[e.status]}
                          color={e.status === "ACTIVE" ? "success" : e.status === "PENDING_ACCOUNTANT_ACCEPTANCE" ? "warning" : "default"}
                        />
                      </TableCell>
                      <TableCell>{formatDateTime(e.grantedAt)}</TableCell>
                      <TableCell align="right">
                        {e.status === "PENDING_ACCOUNTANT_ACCEPTANCE" && (
                          <Button size="small" startIcon={<CheckIcon />} onClick={() => accept.mutate(e.id)} disabled={accept.isPending}>
                            Aceitar
                          </Button>
                        )}
                        {(e.status === "ACTIVE" || e.status === "PENDING_ACCOUNTANT_ACCEPTANCE") && (
                          <Button size="small" color="error" startIcon={<BlockIcon />} onClick={() => setRevokeId(e.id)}>
                            Revogar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
      {grantOpen && <GrantEngagementDialog onClose={() => setGrantOpen(false)} />}
      <ConfirmDialog
        open={revokeId !== null}
        title="Revogar vínculo contábil"
        message="O escritório deixará de ter acesso aos dados deste tenant. Deseja continuar?"
        confirmLabel="Revogar"
        busy={revoke.isPending}
        onConfirm={() => revokeId && revoke.mutate(revokeId)}
        onClose={() => setRevokeId(null)}
      />
    </Stack>
  );
}

function TasksTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["accounting-tasks"], queryFn: () => accountingOfficeApi.listTasks() });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AccountingTaskStatus }) => accountingOfficeApi.updateTask(id, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounting-tasks"] });
      toast.success("Tarefa atualizada.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma tarefa contábil registrada ainda.">
      {(data) => (
        <Paper>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Competência</TableCell>
                  <TableCell>Vencimento</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((t) => (
                  <TableRow key={t.id} hover>
                    <TableCell>{t.competencia}</TableCell>
                    <TableCell>{formatDate(t.dueDate)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={TASK_STATUS_LABEL[t.status]} />
                    </TableCell>
                    <TableCell align="right">
                      {t.status !== "DONE" && (
                        <Button size="small" onClick={() => updateStatus.mutate({ id: t.id, status: "DONE" })} disabled={updateStatus.isPending}>
                          Marcar concluída
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </QueryState>
  );
}

function DocumentsTab() {
  const query = useQuery({ queryKey: ["official-tax-documents"], queryFn: () => accountingOfficeApi.listOfficialDocuments() });
  return (
    <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum documento oficial gerado ainda.">
      {(data) => (
        <Paper>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tipo</TableCell>
                  <TableCell>Gerado em</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((d) => (
                  <TableRow key={d.id} hover>
                    <TableCell>{d.documentType}</TableCell>
                    <TableCell>{formatDateTime(d.generatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </QueryState>
  );
}

export function AccountingOfficePage() {
  const [tab, setTab] = useState(0);
  return (
    <Page>
      <PageHeader
        title="Escritório de contabilidade"
        subtitle="Vínculo (procuração eletrônica interna) com o contador, tarefas recorrentes e documentos oficiais."
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Vínculos" />
        <Tab label="Tarefas" />
        <Tab label="Documentos oficiais" />
      </Tabs>
      {tab === 0 && <EngagementsTab />}
      {tab === 1 && <TasksTab />}
      {tab === 2 && <DocumentsTab />}
    </Page>
  );
}
