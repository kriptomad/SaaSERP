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
  DOCUMENT_TYPE_LABEL,
  PARTNER_PAYOUT_TYPE_LABEL,
  type AccountingEngagementScope,
  type AccountingTaskStatus,
  type OfficialTaxDocumentGenerationType,
  type PartnerPayoutType,
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

const ALL_DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABEL) as OfficialTaxDocumentGenerationType[];

function GenerateDocumentDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [documentType, setDocumentType] = useState<OfficialTaxDocumentGenerationType>("ECD");
  const [competenciaInicio, setCompetenciaInicio] = useState("");
  const [competenciaFim, setCompetenciaFim] = useState("");
  const [calendarYear, setCalendarYear] = useState(String(new Date().getFullYear()));
  const [competencia, setCompetencia] = useState("");
  const [activityType, setActivityType] = useState<"COMERCIO" | "SERVICO">("COMERCIO");
  const [partnerId, setPartnerId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const partnersQuery = useQuery({ queryKey: ["company-partners"], queryFn: accountingOfficeApi.listPartners, enabled: documentType === "INFORME_RENDIMENTOS_SOCIO" });

  const generate = useMutation({
    mutationFn: () => {
      if (documentType === "ECD") {
        return accountingOfficeApi.generateDocument({
          documentType,
          competenciaInicio: new Date(competenciaInicio).toISOString(),
          competenciaFim: new Date(competenciaFim).toISOString(),
        });
      }
      if (documentType === "ECF") {
        return accountingOfficeApi.generateDocument({ documentType, calendarYear: Number(calendarYear), activityType });
      }
      if (documentType === "DEFIS") {
        return accountingOfficeApi.generateDocument({ documentType, calendarYear: Number(calendarYear) });
      }
      if (documentType === "EFD_REINF" || documentType === "DCTFWEB") {
        return accountingOfficeApi.generateDocument({ documentType, competencia });
      }
      return accountingOfficeApi.generateDocument({ documentType, calendarYear: Number(calendarYear), partnerId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["official-tax-documents"] });
      toast.success("Documento gerado com sucesso.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Gerar documento oficial</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Select value={documentType} onChange={(e) => setDocumentType(e.target.value as OfficialTaxDocumentGenerationType)}>
            {ALL_DOCUMENT_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {DOCUMENT_TYPE_LABEL[t]}
              </MenuItem>
            ))}
          </Select>
          {documentType === "ECD" && (
            <>
              <TextField type="date" label="Competência início" value={competenciaInicio} onChange={(e) => setCompetenciaInicio(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField type="date" label="Competência fim" value={competenciaFim} onChange={(e) => setCompetenciaFim(e.target.value)} InputLabelProps={{ shrink: true }} />
            </>
          )}
          {(documentType === "DEFIS" || documentType === "ECF" || documentType === "INFORME_RENDIMENTOS_SOCIO") && (
            <TextField type="number" label="Ano-calendário" value={calendarYear} onChange={(e) => setCalendarYear(e.target.value)} />
          )}
          {documentType === "ECF" && (
            <Select value={activityType} onChange={(e) => setActivityType(e.target.value as "COMERCIO" | "SERVICO")}>
              <MenuItem value="COMERCIO">Comércio (presunção 8% IRPJ / 12% CSLL)</MenuItem>
              <MenuItem value="SERVICO">Serviço (presunção 32% IRPJ / 32% CSLL)</MenuItem>
            </Select>
          )}
          {(documentType === "EFD_REINF" || documentType === "DCTFWEB") && (
            <TextField label="Competência (AAAA-MM)" placeholder="2026-01" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          )}
          {documentType === "INFORME_RENDIMENTOS_SOCIO" && (
            <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} displayEmpty>
              <MenuItem value="" disabled>
                Selecione o sócio
              </MenuItem>
              {(partnersQuery.data ?? []).map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={generate.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" disabled={generate.isPending} onClick={() => { setError(null); generate.mutate(); }}>
          {generate.isPending ? "Gerando…" : "Gerar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DocumentsTab() {
  const query = useQuery({ queryKey: ["official-tax-documents"], queryFn: () => accountingOfficeApi.listOfficialDocuments() });
  const toast = useToast();
  const [generateOpen, setGenerateOpen] = useState(false);

  const download = useMutation({
    mutationFn: (id: string) => accountingOfficeApi.downloadDocument(id),
    onSuccess: (data) => window.open(data.downloadUrl, "_blank"),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setGenerateOpen(true)}>
          Gerar documento
        </Button>
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum documento oficial gerado ainda.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Tipo</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Gerado em</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((d) => (
                    <TableRow key={d.id} hover>
                      <TableCell>{DOCUMENT_TYPE_LABEL[d.documentType as OfficialTaxDocumentGenerationType] ?? d.documentType}</TableCell>
                      <TableCell>
                        <Chip size="small" label={d.status} color={d.status === "DRAFT" ? "warning" : d.status === "GENERATED" ? "success" : "default"} />
                      </TableCell>
                      <TableCell>{formatDateTime(d.generatedAt)}</TableCell>
                      <TableCell align="right">
                        <Button size="small" onClick={() => download.mutate(d.id)} disabled={download.isPending}>
                          Baixar
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
      {generateOpen && <GenerateDocumentDialog onClose={() => setGenerateOpen(false)} />}
    </Stack>
  );
}

function AddPartnerDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [participationPercentage, setParticipationPercentage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => accountingOfficeApi.createPartner({ name: name.trim(), cpf: cpf.trim(), participationPercentage: Number(participationPercentage) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["company-partners"] });
      toast.success("Sócio cadastrado.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Cadastrar sócio</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          <TextField label="CPF" value={cpf} onChange={(e) => setCpf(e.target.value)} required />
          <TextField type="number" label="% de participação societária" value={participationPercentage} onChange={(e) => setParticipationPercentage(e.target.value)} required />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (!name.trim() || !cpf.trim() || !participationPercentage) return setError("Preencha todos os campos.");
            create.mutate();
          }}
        >
          {create.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AddPayoutDialog({ partnerId, onClose }: { partnerId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<PartnerPayoutType>("PRO_LABORE");
  const [competencia, setCompetencia] = useState("");
  const [grossAmount, setGrossAmount] = useState("");
  const [inssWithheld, setInssWithheld] = useState("0");
  const [irrfWithheld, setIrrfWithheld] = useState("0");
  const [paidAt, setPaidAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      accountingOfficeApi.createPartnerPayout(partnerId, {
        type,
        competencia,
        grossAmount: Number(grossAmount),
        inssWithheld: type === "PRO_LABORE" ? Number(inssWithheld) : 0,
        irrfWithheld: type === "PRO_LABORE" ? Number(irrfWithheld) : 0,
        paidAt: new Date(paidAt).toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["partner-payouts", partnerId] });
      toast.success("Pagamento lançado.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Lançar pró-labore / distribuição</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Select value={type} onChange={(e) => setType(e.target.value as PartnerPayoutType)}>
            <MenuItem value="PRO_LABORE">{PARTNER_PAYOUT_TYPE_LABEL.PRO_LABORE}</MenuItem>
            <MenuItem value="PROFIT_DISTRIBUTION">{PARTNER_PAYOUT_TYPE_LABEL.PROFIT_DISTRIBUTION}</MenuItem>
          </Select>
          <TextField label="Competência (AAAA-MM)" placeholder="2026-01" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          <TextField type="number" label="Valor bruto (R$)" value={grossAmount} onChange={(e) => setGrossAmount(e.target.value)} />
          {type === "PRO_LABORE" && (
            <>
              <TextField type="number" label="INSS retido (R$)" value={inssWithheld} onChange={(e) => setInssWithheld(e.target.value)} />
              <TextField type="number" label="IRRF retido (R$)" value={irrfWithheld} onChange={(e) => setIrrfWithheld(e.target.value)} />
            </>
          )}
          <TextField type="date" label="Data de pagamento" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (!competencia || !grossAmount || !paidAt) return setError("Preencha todos os campos obrigatórios.");
            create.mutate();
          }}
        >
          {create.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PartnerPayoutsSection({ partnerId }: { partnerId: string }) {
  const query = useQuery({ queryKey: ["partner-payouts", partnerId], queryFn: () => accountingOfficeApi.listPartnerPayouts(partnerId) });
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Stack spacing={1} sx={{ pl: 2, pb: 2 }}>
      <Stack direction="row" justifyContent="flex-end">
        <Button size="small" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          Lançar pagamento
        </Button>
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum pró-labore/distribuição lançado ainda.">
        {(data) => (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tipo</TableCell>
                <TableCell>Competência</TableCell>
                <TableCell>Bruto</TableCell>
                <TableCell>INSS</TableCell>
                <TableCell>IRRF</TableCell>
                <TableCell>Líquido</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{PARTNER_PAYOUT_TYPE_LABEL[p.type]}</TableCell>
                  <TableCell>{p.competencia}</TableCell>
                  <TableCell>{p.grossAmount}</TableCell>
                  <TableCell>{p.inssWithheld}</TableCell>
                  <TableCell>{p.irrfWithheld}</TableCell>
                  <TableCell>{p.netAmount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryState>
      {addOpen && <AddPayoutDialog partnerId={partnerId} onClose={() => setAddOpen(false)} />}
    </Stack>
  );
}

function PartnersTab() {
  const query = useQuery({ queryKey: ["company-partners"], queryFn: accountingOfficeApi.listPartners });
  const toast = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => accountingOfficeApi.deletePartner(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["company-partners"] });
      toast.success("Sócio removido.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          Cadastrar sócio
        </Button>
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum sócio cadastrado ainda.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nome</TableCell>
                    <TableCell>CPF</TableCell>
                    <TableCell>% participação</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((p) => (
                    <>
                      <TableRow key={p.id} hover>
                        <TableCell>{p.name}</TableCell>
                        <TableCell>{p.cpf}</TableCell>
                        <TableCell>{p.participationPercentage}%</TableCell>
                        <TableCell align="right">
                          <Button size="small" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                            {expandedId === p.id ? "Ocultar pagamentos" : "Ver pagamentos"}
                          </Button>
                          <Button size="small" color="error" onClick={() => remove.mutate(p.id)} disabled={remove.isPending}>
                            Excluir
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expandedId === p.id && (
                        <TableRow key={`${p.id}-payouts`}>
                          <TableCell colSpan={4} sx={{ p: 0 }}>
                            <PartnerPayoutsSection partnerId={p.id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
      {addOpen && <AddPartnerDialog onClose={() => setAddOpen(false)} />}
    </Stack>
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
        <Tab label="Sócios / pró-labore" />
      </Tabs>
      {tab === 0 && <EngagementsTab />}
      {tab === 1 && <TasksTab />}
      {tab === 2 && <DocumentsTab />}
      {tab === 3 && <PartnersTab />}
    </Page>
  );
}
