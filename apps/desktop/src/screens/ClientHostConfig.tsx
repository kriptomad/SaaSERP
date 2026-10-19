// apps/desktop/src/screens/ClientHostConfig.tsx
// Tela de configuração do modo USUÁRIO: IP:porta do PC HOST da rede local. Reaparece
// mais tarde (fora do onboarding) se o lojista trocar o IP do PC central.
import { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import { getDesktopApi, type DesktopConfig } from "../api/desktopApi";
import { clientHostConfigSchema } from "../../electron/validation";

export function ClientHostConfig({ config, onComplete }: { config: DesktopConfig; onComplete: () => void }) {
  const [host, setHost] = useState(config.clientHost?.host ?? "");
  const [port, setPort] = useState(config.clientHost?.port ?? 3333);
  const [useHttps, setUseHttps] = useState(config.clientHost?.useHttps ?? false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string | null } | null>(null);
  // CORREÇÃO DE AUDITORIA (fa-desktop-client-host-config-no-validation): validação
  // runtime real (zod, mesmo schema usado pelo main em `CONFIG_SET_CLIENT_HOST`) de
  // hostname/IP/porta/injeção de caracteres — tipos TS sozinhos desaparecem em
  // runtime e não impediam um `host` com espaços, `;`, ou uma porta fora do range.
  const [validationError, setValidationError] = useState<string | null>(null);

  function validateInput(): { host: string; port: number; useHttps: boolean } | null {
    const result = clientHostConfigSchema.safeParse({ host: host.trim(), port, useHttps });
    if (!result.success) {
      setValidationError(result.error.issues.map((issue) => issue.message).join("; "));
      return null;
    }
    setValidationError(null);
    return result.data;
  }

  async function handleTest() {
    const parsed = validateInput();
    if (!parsed) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await getDesktopApi().network.testCandidateHost(parsed);
      setTestResult({ ok: result.ok, detail: result.detail });
    } catch (error) {
      setTestResult({ ok: false, detail: error instanceof Error ? error.message : "Falha ao testar conexão." });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    const parsed = validateInput();
    if (!parsed) return;
    await getDesktopApi().config.setClientHost(parsed);
    onComplete();
  }

  return (
    <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
      <Stack spacing={3} sx={{ maxWidth: 480, width: "100%" }}>
        <Typography variant="h5">Conectar ao PC central (HOST)</Typography>
        <Typography variant="body2" color="text.secondary">
          Informe o IP e a porta configurados no PC principal da loja (modo HOST).
        </Typography>

        <TextField label="IP do PC central" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.0.10" fullWidth />
        <TextField label="Porta" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} fullWidth />
        <FormControlLabel
          control={<Switch checked={useHttps} onChange={(e) => setUseHttps(e.target.checked)} />}
          label="Usar HTTPS"
        />

        {validationError && <Alert severity="error">{validationError}</Alert>}

        <Stack direction="row" spacing={2}>
          <Button variant="outlined" onClick={handleTest} disabled={!host || testing}>
            {testing ? <CircularProgress size={20} /> : "Testar conexão"}
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={!host}>
            Salvar e continuar
          </Button>
        </Stack>

        {testResult && (
          <Alert severity={testResult.ok ? "success" : "warning"}>
            {testResult.ok ? "Conectado com sucesso ao PC central." : `Não foi possível conectar: ${testResult.detail ?? "sem resposta"}`}
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
