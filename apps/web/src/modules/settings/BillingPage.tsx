// apps/web/src/modules/settings/BillingPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.6 — autoatendimento de cancelamento de
// assinatura (Art. 49 CDC). Consome GET/POST /billing/subscription(/cancel|/cancel/undo).
// Capítulo 9.3 — quando o tenant AINDA não tem nenhuma Subscription (recém-cadastrado,
// Capítulo 1.2), mostra o seletor real de plano/módulos e finaliza a contratação via
// POST /api/billing/checkout, redirecionando para o Checkout hospedado do PSP.
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { api, ApiError } from "../../api/client";
import { PLAN_CATALOG, MODULE_CATALOG } from "../../content/catalog";
import { peekPendingCheckout, clearPendingCheckout } from "../../content/pendingCheckout";

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
  PENDING_CHECKOUT: "Checkout iniciado (aguardando pagamento)",
  TRIAL: "Em período de teste",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento em atraso",
  SUSPENDED: "Suspensa",
  CANCELLED: "Cancelada",
};

interface CheckoutBreakdownItem {
  code: string;
  label: string;
  price: number;
}

interface CheckoutResponse {
  subscriptionId: string;
  computedMrr: number;
  breakdown: CheckoutBreakdownItem[];
  checkoutRedirectUrl: string;
}

function PlanCheckoutPicker() {
  const pending = peekPendingCheckout();
  const [planCode, setPlanCode] = useState(pending?.planCode ?? PLAN_CATALOG[1].code);
  const [moduleCodes, setModuleCodes] = useState<string[]>(pending?.moduleCodes ?? []);
  const [paymentGateway, setPaymentGateway] = useState<"STRIPE" | "ASAAS">("ASAAS");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = PLAN_CATALOG.find((p) => p.code === planCode) ?? PLAN_CATALOG[0];
  const billableModules = MODULE_CATALOG.filter((m) => moduleCodes.includes(m.code) && !plan.includedModules.includes(m.code));
  const estimatedTotal = plan.basePrice + billableModules.reduce((sum, m) => sum + m.monthlyPrice, 0);

  function toggleModule(code: string) {
    setModuleCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function handleCheckout() {
    setError(null);
    setBusy(true);
    try {
      const response = await api.post<CheckoutResponse>("/api/billing/checkout", {
        planCode,
        selectedModuleCodes: moduleCodes,
        billingCycle: "MONTHLY",
        paymentGateway,
      });
      clearPendingCheckout();
      window.location.href = response.checkoutRedirectUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao conectar com o servidor.");
      setBusy(false);
    }
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>
        Escolha seu plano para ativar a assinatura
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack spacing={2}>
        <TextField select label="Plano" value={planCode} onChange={(e) => setPlanCode(e.target.value)} fullWidth>
          {PLAN_CATALOG.map((p) => (
            <MenuItem key={p.code} value={p.code}>
              {p.label} — R$ {p.basePrice.toFixed(2)}/mês
            </MenuItem>
          ))}
        </TextField>
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Módulos à la carte
          </Typography>
          <Stack spacing={0.5}>
            {MODULE_CATALOG.map((m) => {
              const includedInPlan = plan.includedModules.includes(m.code);
              return (
                <FormControlLabel
                  key={m.code}
                  control={
                    <Checkbox
                      checked={includedInPlan || moduleCodes.includes(m.code)}
                      disabled={includedInPlan}
                      onChange={() => toggleModule(m.code)}
                    />
                  }
                  label={`${m.label} — R$ ${m.monthlyPrice.toFixed(2)}/mês${includedInPlan ? " (incluso no plano)" : ""}`}
                />
              );
            })}
          </Stack>
        </Box>
        <TextField select label="Forma de pagamento" value={paymentGateway} onChange={(e) => setPaymentGateway(e.target.value as "STRIPE" | "ASAAS")} fullWidth>
          <MenuItem value="ASAAS">Boleto/Pix/Cartão (Asaas)</MenuItem>
          <MenuItem value="STRIPE">Cartão internacional (Stripe)</MenuItem>
        </TextField>
        <Divider />
        <Stack direction="row" justifyContent="space-between" alignItems="baseline">
          <Typography variant="body1">Total estimado</Typography>
          <Typography variant="h5" fontWeight={800}>
            R$ {estimatedTotal.toFixed(2)}
            <Typography component="span" variant="body2">
              /mês
            </Typography>
          </Typography>
        </Stack>
        <Button variant="contained" size="large" disabled={busy} onClick={handleCheckout}>
          {busy ? "Redirecionando para o pagamento..." : "Ir para o pagamento"}
        </Button>
      </Stack>
    </Paper>
  );
}

export function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [noSubscription, setNoSubscription] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);


  function load() {
    setLoading(true);
    setNoSubscription(false);
    api
      .get<SubscriptionView>("/billing/subscription")
      .then(setSubscription)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNoSubscription(true);
          return;
        }
        setError((err as Error).message);
      })
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
      {!loading && noSubscription && <PlanCheckoutPicker />}
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
          {subscription.status === "PENDING_CHECKOUT" ? (
            <Stack spacing={2}>
              <Alert severity="info">
                O checkout foi iniciado mas o pagamento ainda não foi confirmado. Você pode escolher novamente o
                plano/módulos e tentar de novo.
              </Alert>
              <PlanCheckoutPicker />
            </Stack>
          ) : subscription.status === "CANCELLED" ? (
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
