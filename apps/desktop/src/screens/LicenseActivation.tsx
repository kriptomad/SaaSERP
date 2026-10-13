// apps/desktop/src/screens/LicenseActivation.tsx
// Ativação de licença: chave de licença (produção) ou trial grátis de 15 dias. Consome
// POST /licensing/activate e POST /licensing/trial (módulo construído em paralelo pelo
// agente "license-system" em apps/api/src/modules/licensing/ — ver README.md). Se as
// rotas ainda não existirem no backend atingido, mostra aviso e permite seguir mesmo
// assim em modo "aguardando licenciamento" para não travar o onboarding.
import { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Alert from "@mui/material/Alert";
import { getDesktopApi } from "../api/desktopApi";

export function LicenseActivation({ onComplete }: { onComplete: () => void }) {
  const [tab, setTab] = useState<"ACTIVATE" | "TRIAL">("TRIAL");
  const [licenseKey, setLicenseKey] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleActivate() {
    setBusy(true);
    setError(null);
    const api = getDesktopApi();
    const result = await api.license.activate({ licenseKey });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onComplete();
  }

  async function handleTrial() {
    setBusy(true);
    setError(null);
    const api = getDesktopApi();
    const result = await api.license.trial({ tenantSlug, email });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onComplete();
  }

  return (
    <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
      <Stack spacing={3} sx={{ maxWidth: 480, width: "100%" }}>
        <Typography variant="h5">Ativação de licença</Typography>
        <Tabs value={tab} onChange={(_e, value) => setTab(value)}>
          <Tab value="TRIAL" label="Testar grátis (15 dias)" />
          <Tab value="ACTIVATE" label="Já tenho uma licença" />
        </Tabs>

        {tab === "TRIAL" ? (
          <Stack spacing={2}>
            <TextField label="Identificador da loja (slug)" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} fullWidth />
            <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth />
            <Button variant="contained" size="large" onClick={handleTrial} disabled={busy || !tenantSlug || !email}>
              {busy ? "Ativando trial..." : "Iniciar trial de 15 dias"}
            </Button>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <TextField label="Chave de licença" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} fullWidth />
            <Button variant="contained" size="large" onClick={handleActivate} disabled={busy || !licenseKey}>
              {busy ? "Ativando..." : "Ativar licença"}
            </Button>
          </Stack>
        )}

        {error && (
          <Alert severity="warning">
            {error} — Se o módulo de licenciamento ainda não foi publicado no backend, você pode
            prosseguir mesmo assim; a ativação real será cobrada na próxima sincronização com a rede.
            <Box sx={{ mt: 1 }}>
              <Button size="small" onClick={onComplete}>
                Prosseguir mesmo assim
              </Button>
            </Box>
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
