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

export function ClientHostConfig({ config, onComplete }: { config: DesktopConfig; onComplete: () => void }) {
  const [host, setHost] = useState(config.clientHost?.host ?? "");
  const [port, setPort] = useState(config.clientHost?.port ?? 3333);
  const [useHttps, setUseHttps] = useState(config.clientHost?.useHttps ?? false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string | null } | null>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const scheme = useHttps ? "https" : "http";
    const result = await getDesktopApi().network.pingUrl(`${scheme}://${host}:${port}/health`);
    setTestResult({ ok: result.ok, detail: result.detail });
    setTesting(false);
  }

  async function handleSave() {
    await getDesktopApi().config.patch({ clientHost: { host, port, useHttps } });
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
