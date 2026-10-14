// apps/web/src/modules/platform-admin/InfrastructureSettingsPage.tsx
// Fonte: pedido do usuário em 2026-10-13 — "crie uma aba na administração para eu poder
// configurar por lá, sem precisar ficar dependendo de env variable" para toda credencial
// de infraestrutura (Stripe, Asaas, CORS, licenciamento). Lê/grava via
// platform-secrets.api.ts -> PlatformSecret (cifrado AES-256-GCM, nunca em texto puro).
// Restrito a SUPER_ADMIN na própria API (requireSuperAdmin); aqui a UI oculta a ação de
// gravação para SUPPORT_AGENT/FINANCE_ANALYST, mas a garantia real de autorização é
// sempre o backend.
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";
import { fetchPlatformSecretStatuses, updatePlatformSecret, testR2Connection, PlatformSecretStatus } from "./platform-secrets.api";

function sourceChip(source: PlatformSecretStatus["configuredSource"]) {
  switch (source) {
    case "database":
      return <Chip size="small" color="success" label="Configurado no painel" />;
    case "env":
      return <Chip size="small" color="warning" label="Variável de ambiente (fallback)" />;
    default:
      return <Chip size="small" color="default" label="Não configurado" />;
  }
}

function SecretRow({
  status,
  canEdit,
  onSaved,
}: {
  status: PlatformSecretStatus;
  canEdit: boolean;
  onSaved: (next: PlatformSecretStatus) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const next = await updatePlatformSecret(status.key, value.trim().length > 0 ? value.trim() : null);
      onSaved(next);
      setEditing(false);
      setValue("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!window.confirm(`Remover o override gravado para "${status.label}"? O sistema voltará a usar a variável de ambiente ${status.envFallback}, se existir.`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await updatePlatformSecret(status.key, null);
      onSaved(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="subtitle2">{status.label}</Typography>
            {sourceChip(status.configuredSource)}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {status.description}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Valor atual: {status.maskedValue ?? "— nenhum valor definido —"}
            {status.updatedAt && ` · atualizado em ${new Date(status.updatedAt).toLocaleString("pt-BR")}`}
          </Typography>
        </Box>
        {canEdit && (
          <Stack direction="row" spacing={1}>
            {status.configuredSource === "database" && (
              <IconButton size="small" onClick={handleClear} disabled={saving} title="Remover override gravado no banco">
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            )}
            <Button size="small" variant="outlined" onClick={() => setEditing((e) => !e)}>
              {editing ? "Cancelar" : "Editar"}
            </Button>
          </Stack>
        )}
      </Stack>

      {editing && (
        <Stack spacing={1} sx={{ mt: 2 }}>
          <TextField
            size="small"
            label="Novo valor"
            placeholder={status.placeholder}
            type={showValue ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShowValue((s) => !s)}>
                    {showValue ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button variant="contained" size="small" disabled={saving || value.trim().length === 0} onClick={handleSave} sx={{ alignSelf: "flex-start" }}>
            {saving ? "Salvando..." : "Salvar credencial"}
          </Button>
        </Stack>
      )}
    </Paper>
  );
}

export function InfrastructureSettingsPage() {
  const { admin } = usePlatformAdminAuth();
  const [statuses, setStatuses] = useState<PlatformSecretStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testingR2, setTestingR2] = useState(false);
  const [r2TestResult, setR2TestResult] = useState<{ success: boolean; message: string } | null>(null);

  const canEdit = admin?.role === "SUPER_ADMIN";

  useEffect(() => {
    fetchPlatformSecretStatuses()
      .then(setStatuses)
      .catch((err) => setLoadError((err as Error).message));
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, PlatformSecretStatus[]>();
    for (const status of statuses ?? []) {
      const list = map.get(status.group) ?? [];
      list.push(status);
      map.set(status.group, list);
    }
    return map;
  }, [statuses]);

  function handleSaved(next: PlatformSecretStatus) {
    setStatuses((prev) => (prev ? prev.map((s) => (s.key === next.key ? next : s)) : prev));
  }

  async function handleTestR2() {
    setTestingR2(true);
    setR2TestResult(null);
    try {
      const result = await testR2Connection();
      setR2TestResult(result);
    } catch (err) {
      setR2TestResult({ success: false, message: (err as Error).message });
    } finally {
      setTestingR2(false);
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 900, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Infraestrutura &amp; Credenciais
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Credenciais de PLATAFORMA (Stripe, Asaas, CORS, licenciamento) — cifradas com
        envelope AES-256-GCM e gravadas no banco, sem depender de variável de ambiente.
        Enquanto um valor não for configurado aqui, o sistema continua lendo a variável
        de ambiente correspondente como fallback.
      </Typography>

      {!canEdit && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Sua conta ({admin?.role}) tem apenas acesso de leitura a esta tela — a gravação de
          credenciais é restrita a SUPER_ADMIN.
        </Alert>
      )}

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}

      {!statuses && !loadError && (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      )}

      {statuses &&
        Array.from(grouped.entries()).map(([group, items]) => (
          <Box key={group} sx={{ mb: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1">{group}</Typography>
              {group === "Armazenamento (R2)" && canEdit && (
                <Button size="small" variant="outlined" disabled={testingR2} onClick={handleTestR2}>
                  {testingR2 ? "Testando…" : "Testar conexão R2"}
                </Button>
              )}
            </Stack>
            {group === "Armazenamento (R2)" && r2TestResult && (
              <Alert severity={r2TestResult.success ? "success" : "error"} sx={{ mb: 2 }}>
                {r2TestResult.message}
              </Alert>
            )}
            <Divider sx={{ mb: 2 }} />
            {items.map((status) => (
              <SecretRow key={status.key} status={status} canEdit={canEdit} onSaved={handleSaved} />
            ))}
          </Box>
        ))}
    </Box>
  );
}
