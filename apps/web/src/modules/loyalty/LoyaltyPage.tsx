// apps/web/src/modules/loyalty/LoyaltyPage.tsx
// Tela de Fidelidade: regras do programa, consulta de saldo/extrato por cliente,
// ajuste manual de pontos e indicação (ReferralCode/Referral) entre tenants.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loyaltyApi,
  LOYALTY_TRANSACTION_LABEL,
  REFERRAL_STATUS_LABEL,
  type LoyaltyProgramInput,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { formatDateTime } from "../../shared/ui/format";

function ProgramTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["loyalty-program"], queryFn: loyaltyApi.getProgram });
  const [form, setForm] = useState<LoyaltyProgramInput | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const current: LoyaltyProgramInput =
    form ??
    (query.data
      ? {
          active: query.data.active,
          pointsPerCurrencyUnit: Number(query.data.pointsPerCurrencyUnit),
          redemptionValuePerPoint: Number(query.data.redemptionValuePerPoint),
          minPointsToRedeem: query.data.minPointsToRedeem,
          pointsExpireAfterDays: query.data.pointsExpireAfterDays,
        }
      : { active: false, pointsPerCurrencyUnit: 1, redemptionValuePerPoint: 0.01, minPointsToRedeem: 100, pointsExpireAfterDays: null });

  const mutation = useMutation({
    mutationFn: (input: LoyaltyProgramInput) => loyaltyApi.saveProgram(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["loyalty-program"] });
      toast.success("Programa de fidelidade atualizado.");
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (current.pointsPerCurrencyUnit <= 0 || current.redemptionValuePerPoint <= 0) {
      setFormError("Os valores de ponto devem ser maiores que zero.");
      return;
    }
    mutation.mutate(current);
  }

  return (
    <QueryState query={query}>
      {() => (
        <Paper sx={{ p: 3, maxWidth: 640 }}>
          <Stack spacing={2}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <FormControlLabel
              control={
                <Switch checked={current.active} onChange={(e) => setForm({ ...current, active: e.target.checked })} />
              }
              label="Programa ativo"
            />
            <TextField
              label="Pontos por R$ 1,00 gasto"
              value={current.pointsPerCurrencyUnit}
              onChange={(e) => setForm({ ...current, pointsPerCurrencyUnit: Number(e.target.value) || 0 })}
            />
            <TextField
              label="Valor de resgate por ponto (R$)"
              value={current.redemptionValuePerPoint}
              onChange={(e) => setForm({ ...current, redemptionValuePerPoint: Number(e.target.value) || 0 })}
            />
            <TextField
              label="Mínimo de pontos para resgatar"
              value={current.minPointsToRedeem}
              onChange={(e) => setForm({ ...current, minPointsToRedeem: Math.round(Number(e.target.value) || 0) })}
            />
            <TextField
              label="Pontos expiram após (dias, opcional)"
              value={current.pointsExpireAfterDays ?? ""}
              onChange={(e) =>
                setForm({ ...current, pointsExpireAfterDays: e.target.value ? Math.round(Number(e.target.value)) : null })
              }
            />
            <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar programa"}
            </Button>
          </Stack>
        </Paper>
      )}
    </QueryState>
  );
}

function AccountTab() {
  const toast = useToast();
  const [client, setClient] = useState<Client | null>(null);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const summary = useQuery({
    queryKey: ["loyalty-account", client?.id],
    queryFn: () => loyaltyApi.getAccount(client!.id),
    enabled: Boolean(client),
  });
  const transactions = useQuery({
    queryKey: ["loyalty-transactions", client?.id],
    queryFn: () => loyaltyApi.listTransactions(client!.id),
    enabled: Boolean(client),
  });

  const adjust = useMutation({
    mutationFn: () => loyaltyApi.adjust(client!.id, { points: Math.round(Number(adjustPoints)), reason: adjustReason.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["loyalty-account", client?.id] });
      void queryClient.invalidateQueries({ queryKey: ["loyalty-transactions", client?.id] });
      toast.success("Ajuste de pontos registrado.");
      setAdjustPoints("");
      setAdjustReason("");
    },
    onError: (error) => setAdjustError(errorMessage(error)),
  });

  function submitAdjust() {
    setAdjustError(null);
    const points = Math.round(Number(adjustPoints));
    if (!points) return setAdjustError("Informe uma quantidade de pontos diferente de zero.");
    if (adjustReason.trim().length < 3) return setAdjustError("Informe o motivo do ajuste (mínimo 3 caracteres).");
    adjust.mutate();
  }

  // GAP DE AUDITORIA FECHADO (Capítulo 4.1.1, Rodada 15): só havia ajuste manual —
  // nenhuma UI expunha o resgate de pontos como desconto (o endpoint dedicado
  // POST /loyalty/accounts/:clientId/redeem). Usado aqui como resgate avulso
  // (gerente processa o resgate e aplica o desconto manualmente no PDV); a
  // integração automática dentro do fechamento de venda offline-first do PDV fica
  // documentada como próximo passo (ver DEEP_AUDIT_REPORT.md).
  const redeem = useMutation({
    mutationFn: () => loyaltyApi.redeem(client!.id, { points: Math.round(Number(redeemPoints)) }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["loyalty-account", client?.id] });
      void queryClient.invalidateQueries({ queryKey: ["loyalty-transactions", client?.id] });
      setRedeemSuccess(`Resgate de ${Math.abs(data.transaction.points)} ponto(s) — aplique R$ ${data.discountValue.toFixed(2)} de desconto na venda.`);
      setRedeemPoints("");
    },
    onError: (error) => setRedeemError(errorMessage(error)),
  });

  function submitRedeem() {
    setRedeemError(null);
    setRedeemSuccess(null);
    const points = Math.round(Number(redeemPoints));
    if (!points || points <= 0) return setRedeemError("Informe uma quantidade de pontos positiva.");
    redeem.mutate();
  }

  return (
    <Stack spacing={2}>
      <ClientPicker value={client} onChange={setClient} label="Buscar cliente" />
      {client && (
        <QueryState query={summary}>
          {(data) => (
            <Paper sx={{ p: 2 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={3}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Saldo de pontos
                  </Typography>
                  <Typography variant="h5">{data.pointsBalance}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Resgatável
                  </Typography>
                  <Typography variant="h6">
                    {data.redeemable ? `Sim (R$ ${data.redeemableValue.toFixed(2)})` : "Não"}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Programa
                  </Typography>
                  <Chip size="small" label={data.programActive ? "Ativo" : "Inativo"} color={data.programActive ? "success" : "default"} />
                </Box>
              </Stack>
            </Paper>
          )}
        </QueryState>
      )}
      {client && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Ajuste manual
          </Typography>
          {adjustError && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {adjustError}
            </Alert>
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Pontos (+ ou −)"
              value={adjustPoints}
              onChange={(e) => setAdjustPoints(e.target.value)}
              sx={{ minWidth: 160 }}
            />
            <TextField label="Motivo" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} fullWidth />
            <Button variant="contained" onClick={submitAdjust} disabled={adjust.isPending}>
              {adjust.isPending ? "Ajustando…" : "Ajustar"}
            </Button>
          </Stack>
        </Paper>
      )}
      {client && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Resgatar pontos (desconto)
          </Typography>
          {redeemError && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {redeemError}
            </Alert>
          )}
          {redeemSuccess && (
            <Alert severity="success" sx={{ mb: 1 }}>
              {redeemSuccess}
            </Alert>
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Pontos a resgatar"
              value={redeemPoints}
              onChange={(e) => setRedeemPoints(e.target.value)}
              sx={{ minWidth: 160 }}
            />
            <Button variant="contained" onClick={submitRedeem} disabled={redeem.isPending}>
              {redeem.isPending ? "Resgatando…" : "Resgatar"}
            </Button>
          </Stack>
        </Paper>
      )}
      {client && (
        <QueryState query={transactions} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma transação de pontos para este cliente.">
          {(data) => (
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Data</TableCell>
                      <TableCell>Tipo</TableCell>
                      <TableCell align="right">Pontos</TableCell>
                      <TableCell>Motivo</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.map((t) => (
                      <TableRow key={t.id} hover>
                        <TableCell>{formatDateTime(t.createdAt)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={LOYALTY_TRANSACTION_LABEL[t.type]} />
                        </TableCell>
                        <TableCell align="right">{t.points}</TableCell>
                        <TableCell>{t.reason ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </QueryState>
      )}
    </Stack>
  );
}

function ReferralsTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const myCode = useQuery({ queryKey: ["referral-code"], queryFn: loyaltyApi.myReferralCode });
  const referrals = useQuery({ queryKey: ["referrals"], queryFn: loyaltyApi.listReferrals });

  const register = useMutation({
    mutationFn: () => loyaltyApi.registerReferral(code.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
      toast.success("Indicação registrada.");
      setCode("");
    },
    onError: (error) => setRegisterError(errorMessage(error)),
  });

  return (
    <Stack spacing={2}>
      <QueryState query={myCode}>
        {(data) => (
          <Paper sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Seu código de indicação
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h5">{data.code}</Typography>
              <Button
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={() => {
                  void navigator.clipboard.writeText(data.code);
                  toast.success("Código copiado.");
                }}
              >
                Copiar
              </Button>
            </Stack>
          </Paper>
        )}
      </QueryState>
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Registrar que fui indicado por outro tenant
        </Typography>
        {registerError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {registerError}
          </Alert>
        )}
        <Stack direction="row" spacing={2}>
          <TextField label="Código recebido" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button
            variant="contained"
            onClick={() => {
              setRegisterError(null);
              if (code.trim().length < 3) return setRegisterError("Informe um código válido.");
              register.mutate();
            }}
            disabled={register.isPending}
          >
            {register.isPending ? "Registrando…" : "Registrar"}
          </Button>
        </Stack>
      </Paper>
      <QueryState query={referrals} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma indicação registrada ainda.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Tenant indicado</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Expira em</TableCell>
                    <TableCell>Criada em</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell>{r.referredTenant.tradeName}</TableCell>
                      <TableCell>
                        <Chip size="small" label={REFERRAL_STATUS_LABEL[r.status]} />
                      </TableCell>
                      <TableCell>{formatDateTime(r.expiresAt)}</TableCell>
                      <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
    </Stack>
  );
}

export function LoyaltyPage() {
  const [tab, setTab] = useState(0);
  return (
    <Page>
      <PageHeader title="Fidelidade" subtitle="Programa de pontos, contas de clientes e indicação entre tenants." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Programa" />
        <Tab label="Contas de pontos" />
        <Tab label="Indicação" />
      </Tabs>
      {tab === 0 && <ProgramTab />}
      {tab === 1 && <AccountTab />}
      {tab === 2 && <ReferralsTab />}
    </Page>
  );
}
