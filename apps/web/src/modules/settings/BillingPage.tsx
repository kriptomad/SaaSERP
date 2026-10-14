// apps/web/src/modules/settings/BillingPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.6 — autoatendimento de cancelamento de
// assinatura (Art. 49 CDC). Consome GET/POST /billing/subscription(/cancel|/cancel/undo).
import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Divider, Paper, Stack, Typography } from "@mui/material";
import { api } from "../../api/client";

interface SubscriptionView {
  id: string;
  status: string;
  provider: string;
  currentPeriodEnd: string | null;
  firstChargedAt: string | null;
  cancelRequestedAt: string | null;
  cancelAtPeriodEnd: boolean;
  creditBalanceMonths: number;
  firstCycleDiscountPercent: number | null;
  inRegretWindow: boolean;
  regretWindowDays: number;
  plan: { code: string; label: string; basePrice: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  TRIAL: "Em período de teste",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento em atraso",
  SUSPENDED: "Suspensa",
  CANCELLED: "Cancelada",
};

export function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get<SubscriptionView>("/billing/subscription")
      .then(setSubscription)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCancel() {
    setError(null);
    setMessage(null);
    const immediate = subscription?.inRegretWindow;
    const confirmed = window.confirm(
      immediate
        ? "Você está dentro do prazo de arrependimento (Art. 49 CDC). O cancelamento será imediato e a última cobrança será reembolsada integralmente. Confirmar?"
        : "O cancelamento será agendado para o fim do ciclo atual — você mantém acesso total até lá. Confirmar?",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const updated = await api.post<SubscriptionView>("/billing/subscription/cancel");
      setSubscription((prev) => (prev ? { ...prev, ...updated } : updated));
      setMessage(immediate ? "Assinatura cancelada e reembolso processado." : "Cancelamento agendado para o fim do ciclo atual.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const updated = await api.post<SubscriptionView>("/billing/subscription/cancel/undo");
      setSubscription((prev) => (prev ? { ...prev, ...updated } : updated));
      setMessage("Cancelamento desfeito — sua assinatura continuará normalmente.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Assinatura e cobrança
      </Typography>
      {loading && <Typography color="text.secondary">Carregando…</Typography>}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}
      {subscription && (
        <Paper sx={{ p: 2 }}>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="subtitle1">{subscription.plan?.label ?? "Plano"}</Typography>
            <Chip
              size="small"
              label={STATUS_LABEL[subscription.status] ?? subscription.status}
              color={subscription.status === "ACTIVE" ? "success" : subscription.status === "CANCELLED" ? "default" : "warning"}
            />
          </Stack>
          {subscription.creditBalanceMonths > 0 && (
            <Typography variant="body2" sx={{ mb: 1 }}>
              Crédito acumulado por indicações: {subscription.creditBalanceMonths} mês(es) — abatido automaticamente
              antes da próxima cobrança no cartão.
            </Typography>
          )}
          {subscription.currentPeriodEnd && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Ciclo atual até {new Date(subscription.currentPeriodEnd).toLocaleDateString("pt-BR")}.
            </Typography>
          )}
          <Divider sx={{ my: 2 }} />
          {subscription.status === "CANCELLED" ? (
            <Alert severity="info">Esta assinatura já foi cancelada.</Alert>
          ) : subscription.cancelRequestedAt ? (
            <Stack spacing={2}>
              <Alert severity="warning">
                Cancelamento agendado para {subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("pt-BR") : "o fim do ciclo atual"}
                . Você mantém acesso total até lá.
              </Alert>
              <Button variant="outlined" disabled={busy} onClick={handleUndo} sx={{ alignSelf: "flex-start" }}>
                Desfazer cancelamento
              </Button>
            </Stack>
          ) : (
            <Stack spacing={2}>
              {subscription.inRegretWindow && (
                <Alert severity="info">
                  Você está dentro do prazo de arrependimento de {subscription.regretWindowDays} dias (Art. 49 CDC):
                  cancelar agora encerra o acesso imediatamente e reembolsa integralmente a última cobrança.
                </Alert>
              )}
              <Button variant="outlined" color="error" disabled={busy} onClick={handleCancel} sx={{ alignSelf: "flex-start" }}>
                Cancelar assinatura
              </Button>
            </Stack>
          )}
        </Paper>
      )}
    </Box>
  );
}
