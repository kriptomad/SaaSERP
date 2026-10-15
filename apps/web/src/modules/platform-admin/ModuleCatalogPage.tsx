// apps/web/src/modules/platform-admin/ModuleCatalogPage.tsx
// Capítulo 15.2 — catálogo de módulos/feature flags globais, com rollout percentual
// e lista opcional de tenants beneficiados antecipadamente (early access).
import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";
import { listFeatureFlags, createFeatureFlag, updateFeatureFlag, FeatureFlag } from "./platform-admin-ops.api";

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

  async function toggleActive(flag: FeatureFlag) {
    try {
      const updated = await updateFeatureFlag(flag.id, { active: !flag.active });
      setFlags((prev) => prev?.map((f) => (f.id === updated.id ? updated : f)) ?? null);
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
                <TableCell align="right">{flag.rolloutPercent}%</TableCell>
                <TableCell><Chip size="small" label={`${flag.enabledForTenantIds.length} tenant(s)`} /></TableCell>
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
