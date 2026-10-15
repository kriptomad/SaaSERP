// apps/web/src/modules/settings/IntegrationsPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 20 (IntegrationCredential por provedor) e
// Capítulo 15.4 (TenantApiKey/TenantWebhookEndpoint self-service).
//
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 4): os três backends abaixo já eram
// genéricos, reais e completos (`integration-credentials.routes.ts`,
// `tenant-integrations.routes.ts`) desde rodadas anteriores, mas NENHUMA tela os
// consumia — só o provedor TEF_CLISITEF tinha uma seção dedicada em
// HardwarePage.tsx (que continua lá, por isso é excluído da lista genérica abaixo
// para não duplicar/conflitar com aquele fluxo). Esta página fecha o gap "função que
// existe no backend mas não é configurável via tela admin".
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import HistoryIcon from "@mui/icons-material/History";
import { api } from "../../api/client";

interface IntegrationCredentialSummary {
  id: string;
  provider: string;
  environment: "SANDBOX" | "PRODUCTION";
  active: boolean;
  lastTestedAt: string | null;
  lastTestSuccess: boolean | null;
  lastTestMessage: string | null;
  payloadPreview: Record<string, string> | null;
}

// Exclui STORAGE_CLOUDFLARE_R2 (credencial de PLATAFORMA — Cloudflare R2 é um bucket
// único da Filitech, configurado em PlatformSecret pelo painel admin global, nunca
// por tenant) e BANK_OPEN_FINANCE_PLUGGY (também credencial única de plataforma via
// PlatformSecret, ver `lib/pluggy-client.ts`/`getPlatformSecret`) e TEF_CLISITEF (já
// tem seção dedicada em Configurações → Hardware do PDV).
const PROVIDERS: Array<{
  value: string;
  label: string;
  fields: Array<{ key: string; label: string; type?: "text" | "password" }>;
  help: string;
}> = [
  {
    value: "WHATSAPP_META_CLOUD",
    label: "WhatsApp (Meta Cloud API)",
    fields: [
      { key: "accessToken", label: "Access Token", type: "password" },
      { key: "phoneNumberId", label: "Phone Number ID" },
    ],
    help: "Credenciais do app WhatsApp Business (developers.facebook.com) usadas para notificações e confirmação de pedidos.",
  },
  {
    value: "FISCAL_FOCUS_NFE",
    label: "Emissão Fiscal (Focus NFe)",
    fields: [{ key: "token", label: "Token da empresa", type: "password" }],
    help: "Token da empresa cadastrado no painel Focus NFe (Capítulo 20) — usado para emitir NFC-e/NF-e.",
  },
  {
    value: "BILLING_ASAAS",
    label: "Cobrança (Asaas)",
    fields: [{ key: "accessToken", label: "Access Token", type: "password" }],
    help: "Token de API da conta Asaas do lojista (ambiente Sandbox ou Produção, selecionável abaixo).",
  },
  {
    value: "BILLING_STRIPE",
    label: "Cobrança (Stripe)",
    fields: [{ key: "secretKey", label: "Secret Key", type: "password" }],
    help: "Secret key da conta Stripe (sk_live_... ou sk_test_...).",
  },
  {
    value: "EMAIL_RESEND",
    label: "E-mail transacional (Resend)",
    fields: [{ key: "apiKey", label: "API Key", type: "password" }],
    help: "API Key da conta Resend usada para envio de e-mails de notificação/cobrança.",
  },
  {
    value: "SMS_ZENVIA",
    label: "SMS (Zenvia)",
    fields: [
      { key: "apiToken", label: "API Token", type: "password" },
      { key: "from", label: "Remetente (From)" },
    ],
    help: "Token de API e identificador de remetente (sender ID) da conta Zenvia — usado no canal SMS de notificações.",
  },
  {
    value: "VEHICLE_DATA_FIPE_PLACA",
    label: "Consulta de Placa (FIPE/Placa)",
    fields: [{ key: "apiKey", label: "API Key", type: "password" }],
    help: "Chave da API de consulta de veículo por placa, usada em Oficina Mecânica/Autoelétrica.",
  },
  {
    value: "MARKETPLACE_IFOOD",
    label: "Marketplace (iFood)",
    fields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret", type: "password" },
      { key: "merchantId", label: "Merchant ID" },
    ],
    help: "Credenciais OAuth do app cadastrado no Portal do Parceiro iFood, usadas para validar webhooks de pedidos.",
  },
];

// Catálogo de eventos reais disparados por `dispatchWebhookEvent()` no backend
// (grep em apps/api/src: close-sale.service.ts e emit-fiscal-document.service.ts) —
// mantém a lista sincronizada manualmente com os call sites reais, nunca um valor
// especulativo.
const WEBHOOK_EVENT_TYPES = ["sale.completed", "fiscal_document.authorized"];

interface TenantApiKeySummary {
  id: string;
  label: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface TenantWebhookEndpointSummary {
  id: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  createdAt: string;
}

interface WebhookDelivery {
  id: string;
  eventType: string;
  httpStatus: number | null;
  success: boolean;
  deliveredAt: string;
}

function ProviderCredentialCard({
  provider,
  credential,
  onChanged,
}: {
  provider: (typeof PROVIDERS)[number];
  credential: IntegrationCredentialSummary | null;
  onChanged: () => void;
}) {
  const [environment, setEnvironment] = useState<"SANDBOX" | "PRODUCTION">(credential?.environment ?? "PRODUCTION");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await api.put("/integration-credentials", { provider: provider.value, environment, payload: values });
      setMessage("Credencial salva com sucesso.");
      setValues({});
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar credencial.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!credential) return;
    setTesting(true);
    setMessage(null);
    try {
      const result = await api.post<{ success: boolean; message: string }>(`/integration-credentials/${credential.id}/test`);
      setMessage(result.message);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao testar credencial.");
    } finally {
      setTesting(false);
    }
  }

  async function handleDeactivate() {
    if (!credential) return;
    await api.patch(`/integration-credentials/${credential.id}/deactivate`);
    onChanged();
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>{provider.label}</Typography>
          <Typography variant="body2" color="text.secondary">{provider.help}</Typography>
        </Box>
        {credential && (
          <Chip
            size="small"
            label={credential.active ? "Ativa" : "Inativa"}
            color={credential.active ? "success" : "default"}
          />
        )}
      </Stack>

      {credential?.payloadPreview && (
        <Box mt={1}>
          <Typography variant="caption" color="text.secondary">
            Valor salvo:{" "}
            {Object.entries(credential.payloadPreview).map(([key, masked]) => `${key}=${masked}`).join(", ")}
            {credential.lastTestedAt && ` · Último teste: ${credential.lastTestSuccess ? "OK" : "falhou"} (${credential.lastTestMessage ?? ""})`}
          </Typography>
        </Box>
      )}

      <Stack direction="row" spacing={2} mt={2} flexWrap="wrap" useFlexGap>
        <TextField
          select
          size="small"
          label="Ambiente"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as "SANDBOX" | "PRODUCTION")}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="PRODUCTION">Produção</MenuItem>
          <MenuItem value="SANDBOX">Sandbox</MenuItem>
        </TextField>
        {provider.fields.map((field) => (
          <TextField
            key={field.key}
            size="small"
            label={field.label}
            type={field.type ?? "text"}
            value={values[field.key] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            sx={{ minWidth: 220 }}
          />
        ))}
      </Stack>

      <Stack direction="row" spacing={1} mt={2}>
        <Button variant="contained" size="small" disabled={saving} onClick={handleSave}>
          {credential ? "Atualizar credencial" : "Salvar credencial"}
        </Button>
        {credential && (
          <>
            <Button variant="outlined" size="small" disabled={testing} onClick={handleTest}>
              Testar conexão
            </Button>
            {credential.active && (
              <Button variant="outlined" color="error" size="small" onClick={handleDeactivate}>
                Desativar
              </Button>
            )}
          </>
        )}
      </Stack>

      {message && <Alert severity="info" sx={{ mt: 2 }}>{message}</Alert>}
    </Paper>
  );
}

function ApiKeysSection() {
  const [keys, setKeys] = useState<TenantApiKeySummary[]>([]);
  const [label, setLabel] = useState("");
  const [scopesInput, setScopesInput] = useState("read");
  const [rawKeyDialog, setRawKeyDialog] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.get<TenantApiKeySummary[]>("/integrations/api-keys").then(setKeys).catch(() => undefined);
  }, []);

  useEffect(reload, [reload]);

  async function handleCreate() {
    if (!label.trim()) return;
    setMessage(null);
    try {
      const scopes = scopesInput.split(",").map((s) => s.trim()).filter(Boolean);
      const created = await api.post<TenantApiKeySummary & { rawKey: string }>("/integrations/api-keys", { label, scopes });
      setRawKeyDialog(created.rawKey);
      setLabel("");
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar chave de API.");
    }
  }

  async function handleRevoke(id: string) {
    await api.post(`/integrations/api-keys/${id}/revoke`);
    reload();
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Chaves de API</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Chaves usadas por integrações externas para chamar a API REST do Filitech ERP em nome deste tenant (Capítulo 15.4).
      </Typography>

      <Stack direction="row" spacing={2} mt={2} flexWrap="wrap" useFlexGap alignItems="center">
        <TextField size="small" label="Nome/rótulo" value={label} onChange={(e) => setLabel(e.target.value)} />
        <TextField
          size="small"
          label="Escopos (separados por vírgula)"
          value={scopesInput}
          onChange={(e) => setScopesInput(e.target.value)}
          sx={{ minWidth: 260 }}
        />
        <Button variant="contained" size="small" onClick={handleCreate}>Gerar chave</Button>
      </Stack>
      {message && <Alert severity="error" sx={{ mt: 2 }}>{message}</Alert>}

      <Stack spacing={1} mt={2}>
        {keys.map((key) => (
          <Stack key={key.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ borderBottom: "1px solid", borderColor: "divider", pb: 1 }}>
            <Box>
              <Typography variant="body2" fontWeight={600}>{key.label} — {key.keyPrefix}…</Typography>
              <Typography variant="caption" color="text.secondary">
                Escopos: {key.scopes.join(", ")} · Criada em {new Date(key.createdAt).toLocaleDateString("pt-BR")}
                {key.revokedAt ? " · REVOGADA" : key.lastUsedAt ? ` · Último uso: ${new Date(key.lastUsedAt).toLocaleString("pt-BR")}` : " · Nunca usada"}
              </Typography>
            </Box>
            {!key.revokedAt && (
              <IconButton size="small" color="error" onClick={() => handleRevoke(key.id)} title="Revogar">
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
        ))}
        {keys.length === 0 && <Typography variant="body2" color="text.secondary">Nenhuma chave de API criada.</Typography>}
      </Stack>

      <Dialog open={!!rawKeyDialog} onClose={() => setRawKeyDialog(null)}>
        <DialogTitle>Chave gerada</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>Esta chave só é exibida uma única vez. Copie e guarde em local seguro.</Alert>
          <TextField fullWidth value={rawKeyDialog ?? ""} InputProps={{ readOnly: true }} />
        </DialogContent>
        <DialogActions>
          <Button
            startIcon={<ContentCopyIcon />}
            onClick={() => rawKeyDialog && navigator.clipboard.writeText(rawKeyDialog)}
          >
            Copiar
          </Button>
          <Button onClick={() => setRawKeyDialog(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function WebhookEndpointsSection() {
  const [endpoints, setEndpoints] = useState<TenantWebhookEndpointSummary[]>([]);
  const [url, setUrl] = useState("");
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [secretDialog, setSecretDialog] = useState<string | null>(null);
  const [deliveriesDialog, setDeliveriesDialog] = useState<{ endpointId: string; items: WebhookDelivery[] } | null>(null);

  const reload = useCallback(() => {
    api.get<TenantWebhookEndpointSummary[]>("/integrations/webhook-endpoints").then(setEndpoints).catch(() => undefined);
  }, []);

  useEffect(reload, [reload]);

  async function handleCreate() {
    if (!url.trim() || eventTypes.length === 0) {
      setMessage("Informe a URL e selecione ao menos um evento.");
      return;
    }
    setMessage(null);
    try {
      const created = await api.post<TenantWebhookEndpointSummary & { signingSecret: string }>("/integrations/webhook-endpoints", {
        url,
        eventTypes,
      });
      setSecretDialog(created.signingSecret);
      setUrl("");
      setEventTypes([]);
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar webhook.");
    }
  }

  async function handleToggleActive(endpoint: TenantWebhookEndpointSummary) {
    await api.patch(`/integrations/webhook-endpoints/${endpoint.id}`, { active: !endpoint.active });
    reload();
  }

  async function handleViewDeliveries(endpointId: string) {
    const items = await api.get<WebhookDelivery[]>(`/integrations/webhook-endpoints/${endpointId}/deliveries`);
    setDeliveriesDialog({ endpointId, items });
  }

  function toggleEventType(eventType: string) {
    setEventTypes((prev) => (prev.includes(eventType) ? prev.filter((e) => e !== eventType) : [...prev, eventType]));
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Webhooks de saída</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Receba notificações HTTP em tempo real para eventos como venda concluída ou documento fiscal autorizado (Capítulo 15.4). A URL deve ser HTTPS pública.
      </Typography>

      <Stack spacing={2} mt={2}>
        <TextField size="small" label="URL de destino (https://...)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {WEBHOOK_EVENT_TYPES.map((eventType) => (
            <Chip
              key={eventType}
              label={eventType}
              color={eventTypes.includes(eventType) ? "primary" : "default"}
              onClick={() => toggleEventType(eventType)}
              size="small"
            />
          ))}
        </Stack>
        <Box>
          <Button variant="contained" size="small" onClick={handleCreate}>Criar webhook</Button>
        </Box>
      </Stack>
      {message && <Alert severity="error" sx={{ mt: 2 }}>{message}</Alert>}

      <Stack spacing={1} mt={2}>
        {endpoints.map((endpoint) => (
          <Stack key={endpoint.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ borderBottom: "1px solid", borderColor: "divider", pb: 1 }}>
            <Box>
              <Typography variant="body2" fontWeight={600}>{endpoint.url}</Typography>
              <Typography variant="caption" color="text.secondary">
                Eventos: {endpoint.eventTypes.join(", ")} · Criado em {new Date(endpoint.createdAt).toLocaleDateString("pt-BR")}
              </Typography>
            </Box>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Tooltip title="Histórico de entregas">
                <IconButton size="small" onClick={() => handleViewDeliveries(endpoint.id)}>
                  <HistoryIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Switch size="small" checked={endpoint.active} onChange={() => handleToggleActive(endpoint)} />
            </Stack>
          </Stack>
        ))}
        {endpoints.length === 0 && <Typography variant="body2" color="text.secondary">Nenhum webhook configurado.</Typography>}
      </Stack>

      <Dialog open={!!secretDialog} onClose={() => setSecretDialog(null)}>
        <DialogTitle>Segredo de assinatura gerado</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Use este segredo para validar a assinatura HMAC de cada entrega. Só é exibido uma única vez.
          </Alert>
          <TextField fullWidth value={secretDialog ?? ""} InputProps={{ readOnly: true }} />
        </DialogContent>
        <DialogActions>
          <Button
            startIcon={<ContentCopyIcon />}
            onClick={() => secretDialog && navigator.clipboard.writeText(secretDialog)}
          >
            Copiar
          </Button>
          <Button onClick={() => setSecretDialog(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deliveriesDialog} onClose={() => setDeliveriesDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Histórico de entregas</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            {deliveriesDialog?.items.map((delivery) => (
              <Stack key={delivery.id} direction="row" justifyContent="space-between">
                <Typography variant="body2">{delivery.eventType}</Typography>
                <Chip size="small" label={delivery.success ? `OK (${delivery.httpStatus})` : `Falha (${delivery.httpStatus ?? "sem resposta"})`} color={delivery.success ? "success" : "error"} />
                <Typography variant="caption" color="text.secondary">{new Date(delivery.deliveredAt).toLocaleString("pt-BR")}</Typography>
              </Stack>
            ))}
            {(!deliveriesDialog || deliveriesDialog.items.length === 0) && (
              <Typography variant="body2" color="text.secondary">Nenhuma entrega registrada ainda.</Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeliveriesDialog(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export function IntegrationsPage() {
  const [credentials, setCredentials] = useState<IntegrationCredentialSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .get<IntegrationCredentialSummary[]>("/integration-credentials")
      .then(setCredentials)
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Falha ao carregar integrações."));
  }, []);

  useEffect(reload, [reload]);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Integrações</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Cadastre e teste credenciais de provedores externos, gere chaves de API e configure webhooks de saída. A
        credencial de TEF/pinpad fica em Configurações → Hardware do PDV.
      </Typography>
      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}

      <Stack spacing={2} mt={2}>
        {PROVIDERS.map((provider) => (
          <ProviderCredentialCard
            key={provider.value}
            provider={provider}
            credential={credentials.find((c) => c.provider === provider.value) ?? null}
            onChanged={reload}
          />
        ))}
      </Stack>

      <Divider sx={{ my: 3 }} />
      <ApiKeysSection />
      <Box mt={3} />
      <WebhookEndpointsSection />
    </Box>
  );
}
