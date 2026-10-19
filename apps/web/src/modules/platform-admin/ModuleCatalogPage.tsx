// apps/web/src/modules/platform-admin/ModuleCatalogPage.tsx
// Capítulo 15.2 — catálogo de módulos/feature flags globais, com rollout percentual
// e lista opcional de tenants beneficiados antecipadamente (early access).
// GAP DE AUDITORIA FECHADO (mega-audit round de 100%, criticidade MEDIA): o backend
// já aceitava PATCH de `rolloutPercent`/`enabledForTenantIds` desde sempre, mas esta
// tela só deixava definir o rollout % na CRIAÇÃO (nunca editar depois) e mostrava a
// lista de early access apenas como contador somente-leitura — nenhum jeito de
// adicionar/remover um tenant de rollout antecipado sem acesso direto ao banco.
// Adicionado: edição inline de rollout %, e um seletor por tenant (busca por
// nome/slug/CNPJ via `listTenants`) para adicionar/remover da lista
// `enabledForTenantIds`.
import { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";
import { listFeatureFlags, createFeatureFlag, updateFeatureFlag, FeatureFlag, listTenants, TenantSummary } from "./platform-admin-ops.api";

function NewFlagForm({ onCreated }: { onCreated: (flag: FeatureFlag) => void }) {
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [rolloutPercent, setRolloutPercent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const flag = await createFeatureFlag({ key, description, rolloutPercent, enabledForTenantIds: [], active: true });
      onCreated(flag);
      setKey("");
      setDescription("");
      setRolloutPercent(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>Novo módulo / feature flag</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <TextField label="Chave (ex.: WORK_ORDER)" size="small" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} sx={{ minWidth: 220 }} />
        <TextField label="Descrição" size="small" value={description} onChange={(e) => setDescription(e.target.value)} sx={{ minWidth: 300 }} />
        <TextField label="Rollout %" type="number" size="small" value={rolloutPercent} onChange={(e) => setRolloutPercent(Number(e.target.value))} sx={{ minWidth: 120 }} />
      </Stack>
      <Button variant="contained" sx={{ mt: 2 }} disabled={saving || !key || !description} onClick={handleCreate}>Criar</Button>
    </Paper>
  );
}

function RolloutPercentEditor({ flag, canEdit, onSaved }: { flag: FeatureFlag; canEdit: boolean; onSaved: (flag: FeatureFlag) => void }) {
  const [value, setValue] = useState(flag.rolloutPercent);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(flag.rolloutPercent), [flag.rolloutPercent]);

  async function commit() {
    if (value === flag.rolloutPercent) return;
    setSaving(true);
    try {
      const clamped = Math.min(100, Math.max(0, Math.round(value)));
      const updated = await updateFeatureFlag(flag.id, { rolloutPercent: clamped });
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <TextField
      type="number"
      size="small"
      value={value}
      disabled={!canEdit || saving}
      onChange={(e) => setValue(Number(e.target.value))}
      onBlur={commit}
      sx={{ width: 90 }}
      inputProps={{ min: 0, max: 100 }}
    />
  );
}

function EarlyAccessEditor({ flag, canEdit, onSaved }: { flag: FeatureFlag; canEdit: boolean; onSaved: (flag: FeatureFlag) => void }) {
  const [open, setOpen] = useState(false);
  const [tenantOptions, setTenantOptions] = useState<TenantSummary[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      listTenants(search ? { search } : undefined).then((result) => setTenantOptions(result.items)).catch(() => setTenantOptions([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [open, search]);

  const enabledTenants = tenantOptions.filter((t) => flag.enabledForTenantIds.includes(t.id));

  async function addTenant(tenant: TenantSummary | null) {
    if (!tenant || flag.enabledForTenantIds.includes(tenant.id)) return;
    setSaving(true);
    try {
      const updated = await updateFeatureFlag(flag.id, { enabledForTenantIds: [...flag.enabledForTenantIds, tenant.id] });
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  async function removeTenant(tenantId: string) {
    setSaving(true);
    try {
      const updated = await updateFeatureFlag(flag.id, { enabledForTenantIds: flag.enabledForTenantIds.filter((id) => id !== tenantId) });
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box>
      <Chip
        size="small"
        label={`${flag.enabledForTenantIds.length} tenant(s)`}
        onClick={() => setOpen((v) => !v)}
        clickable={canEdit}
      />
      <Collapse in={open}>
        <Stack spacing={1} sx={{ mt: 1, minWidth: 320 }}>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {enabledTenants.map((t) => (
              <Chip key={t.id} size="small" label={`${t.tradeName} (${t.slug})`} onDelete={canEdit ? () => removeTenant(t.id) : undefined} />
            ))}
            {flag.enabledForTenantIds.length > enabledTenants.length && (
              <Typography variant="caption" color="text.secondary">
                +{flag.enabledForTenantIds.length - enabledTenants.length} tenant(s) fora da busca atual
              </Typography>
            )}
          </Stack>
          {canEdit && (
            <Autocomplete
              size="small"
              options={tenantOptions}
              getOptionLabel={(t) => `${t.tradeName} (${t.slug})`}
              loading={saving}
              onInputChange={(_e, v) => setSearch(v)}
              onChange={(_e, v) => addTenant(v)}
              renderInput={(params) => <TextField {...params} label="Adicionar tenant ao early access" placeholder="Buscar por nome/slug/CNPJ" />}
            />
          )}
        </Stack>
      </Collapse>
    </Box>
  );
}

export function ModuleCatalogPage() {
  const { admin } = usePlatformAdminAuth();
  const canEdit = admin?.role === "SUPER_ADMIN";
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setFlags(await listFeatureFlags());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function applyUpdatedFlag(updated: FeatureFlag) {
    setFlags((prev) => prev?.map((f) => (f.id === updated.id ? updated : f)) ?? null);
  }

  async function toggleActive(flag: FeatureFlag) {
    try {
      const updated = await updateFeatureFlag(flag.id, { active: !flag.active });
      applyUpdatedFlag(updated);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Catálogo de módulos</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Feature flags globais que controlam rollout gradual de módulos/funcionalidades por tenant.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {canEdit && <NewFlagForm onCreated={(f) => setFlags((prev) => [f, ...(prev ?? [])])} />}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Chave</TableCell>
              <TableCell>Descrição</TableCell>
              <TableCell align="right">Rollout %</TableCell>
              <TableCell>Early access</TableCell>
              <TableCell>Ativa</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(flags ?? []).map((flag) => (
              <TableRow key={flag.id}>
                <TableCell>{flag.key}</TableCell>
                <TableCell>{flag.description}</TableCell>
                <TableCell align="right">
                  <RolloutPercentEditor flag={flag} canEdit={canEdit} onSaved={applyUpdatedFlag} />
                </TableCell>
                <TableCell>
                  <EarlyAccessEditor flag={flag} canEdit={canEdit} onSaved={applyUpdatedFlag} />
                </TableCell>
                <TableCell>
                  <Switch size="small" checked={flag.active} disabled={!canEdit} onChange={() => toggleActive(flag)} />
                </TableCell>
              </TableRow>
            ))}
            {flags && flags.length === 0 && <TableRow><TableCell colSpan={5}>Nenhum módulo cadastrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
