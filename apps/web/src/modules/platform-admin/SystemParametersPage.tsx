// apps/web/src/modules/platform-admin/SystemParametersPage.tsx
// Capítulo 13.4 — parâmetros globais de sistema (ex.: FREE_TIER_MAX_SALES_PER_MONTH),
// editáveis apenas por SUPER_ADMIN, com audit log automático no backend.
import { useEffect, useState } from "react";
import { Alert, Box, Button, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";
import { listSystemParameters, updateSystemParameter, SystemParameter } from "./platform-admin-ops.api";

export function SystemParametersPage() {
  const { admin } = usePlatformAdminAuth();
  const canEdit = admin?.role === "SUPER_ADMIN";
  const [parameters, setParameters] = useState<SystemParameter[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    listSystemParameters().then(setParameters).catch((err) => setError((err as Error).message));
  }, []);

  async function handleSave(key: string) {
    setSavingKey(key);
    setError(null);
    try {
      const updated = await updateSystemParameter(key, edits[key]);
      setParameters((prev) => prev?.map((p) => (p.key === updated.key ? updated : p)) ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Parâmetros de sistema</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Constantes globais que afetam o comportamento da plataforma (limites de plano gratuito, janelas de tempo, etc.).
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Chave</TableCell>
              <TableCell>Descrição</TableCell>
              <TableCell>Valor</TableCell>
              {canEdit && <TableCell align="right">Ações</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {(parameters ?? []).map((param) => (
              <TableRow key={param.key}>
                <TableCell><code>{param.key}</code></TableCell>
                <TableCell>{param.description}</TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    value={edits[param.key] ?? param.value}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [param.key]: e.target.value }))}
                    disabled={!canEdit}
                  />
                </TableCell>
                {canEdit && (
                  <TableCell align="right">
                    <Button size="small" disabled={savingKey === param.key || (edits[param.key] ?? param.value) === param.value} onClick={() => handleSave(param.key)}>
                      Salvar
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {parameters && parameters.length === 0 && <TableRow><TableCell colSpan={canEdit ? 4 : 3}>Nenhum parâmetro cadastrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
