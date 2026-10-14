// apps/web/src/modules/licensing/LicensingPage.tsx
// Painel admin da Licença Mestra (Capítulo 2.10) — visível apenas ao Owner (gate de
// menu em layout/navigation.tsx + RBAC real no backend via "licensing:license:read").
// Mostra status da licença, módulos liberados, histórico de ativações/dispositivos e
// o botão de ativar trial quando o tenant ainda não possui nenhuma licença mestra.
import { useState } from "react";
import {
  Alert,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Button,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { licensingApi, LICENSE_STATUS_LABEL } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDateTime } from "../../shared/ui/format";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  TRIAL: "warning",
  ACTIVE: "success",
  EXPIRED: "error",
  SUSPENDED: "error",
};

export function LicensingPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [trialError, setTrialError] = useState<string | null>(null);
  const [activationToRevoke, setActivationToRevoke] = useState<{ id: string; label: string } | null>(null);

  const query = useQuery({ queryKey: ["licensing-status"], queryFn: licensingApi.getStatus });

  const trial = useMutation({
    mutationFn: () => licensingApi.startTrial(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["licensing-status"] });
      toast.success("Trial de 15 dias ativado para este tenant.");
    },
    onError: (error) => setTrialError(errorMessage(error)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => licensingApi.revokeActivation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["licensing-status"] });
      toast.success("Dispositivo revogado. Ele deixará de receber tokens offline novos na próxima ativação.");
      setActivationToRevoke(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setActivationToRevoke(null);
    },
  });

  return (
    <Page>
      <PageHeader
        title="Licença Mestra"
        subtitle="Controle técnico de acesso ao ERP e uso offline do app desktop — distinto da assinatura/cobrança (Financeiro)."
      />
      {trialError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {trialError}
        </Alert>
      )}
      <QueryState query={query}>
        {(data) => (
          <Stack spacing={2}>
            {!data.license && (
              <Paper sx={{ p: 3 }}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Nenhuma licença mestra encontrada para este tenant
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Ative o Tier Free/Trial de 15 dias para liberar o uso básico do ERP (sem módulos de nicho) sem precisar de
                  cartão de crédito.
                </Typography>
                <Button
                  variant="contained"
                  disabled={!data.canStartTrial || trial.isPending}
                  onClick={() => {
                    setTrialError(null);
                    trial.mutate();
                  }}
                >
                  {trial.isPending ? "Ativando…" : "Ativar trial de 15 dias"}
                </Button>
              </Paper>
            )}
            {data.license && (
              <Paper sx={{ p: 3 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={4} flexWrap="wrap" useFlexGap>
                  <Stack>
                    <Typography variant="body2" color="text.secondary">
                      Status da licença
                    </Typography>
                    <Chip
                      label={LICENSE_STATUS_LABEL[data.license.status]}
                      color={STATUS_COLOR[data.license.status] ?? "default"}
                      sx={{ mt: 0.5 }}
                    />
                  </Stack>
                  {data.license.status === "TRIAL" && (
                    <Stack>
                      <Typography variant="body2" color="text.secondary">
                        Trial expira em
                      </Typography>
                      <Typography variant="body1">{data.license.trialEndsAt ? formatDateTime(data.license.trialEndsAt) : "—"}</Typography>
                    </Stack>
                  )}
                  <Stack>
                    <Typography variant="body2" color="text.secondary">
                      Última validação online
                    </Typography>
                    <Typography variant="body1">
                      {data.license.lastValidatedAt ? formatDateTime(data.license.lastValidatedAt) : "Nunca ativada"}
                    </Typography>
                  </Stack>
                  <Stack>
                    <Typography variant="body2" color="text.secondary">
                      Token offline válido até
                    </Typography>
                    <Typography variant="body1">
                      {data.license.offlineTokenExpiresAt ? formatDateTime(data.license.offlineTokenExpiresAt) : "—"}
                    </Typography>
                  </Stack>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  Módulos liberados (offline)
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                  {data.license.licensedModules.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      Nenhum módulo de nicho — apenas o ERP básico.
                    </Typography>
                  ) : (
                    data.license.licensedModules.map((m) => <Chip key={m} size="small" label={m} />)
                  )}
                </Stack>
              </Paper>
            )}
            {data.activations && (
              <Paper>
                <Typography variant="subtitle1" sx={{ p: 2, pb: 0 }}>
                  Histórico de ativações/dispositivos
                </Typography>
                {data.activations.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                    Nenhuma ativação de dispositivo registrada ainda.
                  </Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Dispositivo</TableCell>
                          <TableCell>Impressão digital</TableCell>
                          <TableCell>Ativado em</TableCell>
                          <TableCell>Última vez visto</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Ações</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.activations.map((a) => (
                          <TableRow key={a.id} hover>
                            <TableCell>{a.deviceLabel ?? "—"}</TableCell>
                            <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{a.deviceFingerprint}</TableCell>
                            <TableCell>{formatDateTime(a.activatedAt)}</TableCell>
                            <TableCell>{formatDateTime(a.lastSeenAt)}</TableCell>
                            <TableCell>
                              {a.revokedAt ? <Chip size="small" color="error" label="Revogado" /> : <Chip size="small" color="success" label="Ativo" />}
                            </TableCell>
                            <TableCell align="right">
                              {!a.revokedAt && (
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => setActivationToRevoke({ id: a.id, label: a.deviceLabel ?? a.deviceFingerprint })}
                                >
                                  Revogar
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Paper>
            )}
          </Stack>
        )}
      </QueryState>
      <ConfirmDialog
        open={activationToRevoke !== null}
        title="Revogar dispositivo"
        message={
          activationToRevoke
            ? `Revogar "${activationToRevoke.label}"? Este dispositivo deixará de receber novos tokens offline na próxima tentativa de ativação. Um token já emitido e cacheado permanece válido até sua expiração natural (padrão: 7 dias).`
            : ""
        }
        confirmLabel="Revogar"
        busy={revoke.isPending}
        onConfirm={() => activationToRevoke && revoke.mutate(activationToRevoke.id)}
        onClose={() => setActivationToRevoke(null)}
      />
    </Page>
  );
}
