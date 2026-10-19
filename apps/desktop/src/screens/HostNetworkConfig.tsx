// apps/desktop/src/screens/HostNetworkConfig.tsx
// Tela de configuração de rede do modo HOST: IP de bind, porta, pasta de backup e
// agendamento, connection string do Postgres. Ao concluir, tenta subir o backend local.
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import { getDesktopApi, type DesktopConfig } from "../api/desktopApi";

export function HostNetworkConfig({ config, onComplete }: { config: DesktopConfig; onComplete: () => void }) {
  const [bindAddress, setBindAddress] = useState(config.network.bindAddress);
  const [port, setPort] = useState(config.network.port);
  const [backupFolderPath, setBackupFolderPath] = useState(config.network.backupFolderPath ?? "");
  const [backupSchedule, setBackupSchedule] = useState(config.network.backupSchedule);
  const [databaseUrl, setDatabaseUrl] = useState(config.network.databaseUrl);
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    getDesktopApi().network.localIps().then(setLocalIps);
  }, []);

  async function handleChooseFolder() {
    const folder = await getDesktopApi().dialog.chooseFolder();
    if (folder) setBackupFolderPath(folder);
  }

  async function handleSave() {
    setStatus("starting");
    setErrorMessage(null);
    const api = getDesktopApi();
    try {
      await api.config.setNetwork({ bindAddress, port, backupFolderPath: backupFolderPath || null, backupSchedule, databaseUrl });
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Configuração de rede inválida.");
      return;
    }
    const state = await api.backend.start({ bindAddress, port, backupFolderPath, backupSchedule, databaseUrl });
    if (state.status === "ERROR") {
      setStatus("error");
      setErrorMessage(state.lastError ?? "Falha desconhecida ao iniciar o backend local.");
      return;
    }
    onComplete();
  }

  return (
    <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
      <Stack spacing={3} sx={{ maxWidth: 560, width: "100%" }}>
        <Typography variant="h5">Configuração de rede (modo HOST)</Typography>
        <Typography variant="body2" color="text.secondary">
          Outros PCs da loja vão se conectar neste IP e porta. Se este PC tiver mais de uma
          rede (Wi-Fi + cabo, por exemplo), escolha o IP da rede que os outros caixas usam.
        </Typography>

        <FormControl fullWidth>
          <InputLabel id="bind-address-label">IP de bind</InputLabel>
          <Select
            labelId="bind-address-label"
            label="IP de bind"
            value={bindAddress}
            onChange={(e) => setBindAddress(e.target.value)}
          >
            <MenuItem value="0.0.0.0">Todas as redes (0.0.0.0)</MenuItem>
            {localIps.map((ip) => (
              <MenuItem key={ip} value={ip}>
                {ip}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {bindAddress === "0.0.0.0" && (
          <Alert severity="warning">
            Expor em "todas as redes" torna o backend local acessível por QUALQUER dispositivo nas
            redes deste PC (inclusive Wi-Fi pública/convidados), não só pelos caixas da loja. Prefira
            escolher o IP específico da rede interna da loja acima. Garanta também que o firewall do
            Windows bloqueie a porta {port} para redes não confiáveis, e que a rede da loja seja
            isolada/privada — este backend não usa TLS nesta versão (apenas HTTP), então trate-o como
            confiável apenas dentro de uma LAN já protegida.
          </Alert>
        )}

        <TextField
          label="Porta"
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
          fullWidth
        />

        <TextField
          label="Connection string do PostgreSQL"
          value={databaseUrl}
          onChange={(e) => setDatabaseUrl(e.target.value)}
          helperText="Requer um PostgreSQL instalado neste PC (ou acessível na rede). Ver README.md para o guia de instalação — o shell desktop não embute um banco completo nesta versão."
          fullWidth
        />

        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            label="Pasta de backup"
            value={backupFolderPath}
            fullWidth
            InputProps={{ readOnly: true }}
          />
          <Button variant="outlined" onClick={handleChooseFolder}>
            Escolher...
          </Button>
        </Stack>

        <FormControl fullWidth>
          <InputLabel id="backup-schedule-label">Agendamento de backup</InputLabel>
          <Select
            labelId="backup-schedule-label"
            label="Agendamento de backup"
            value={backupSchedule}
            onChange={(e) => setBackupSchedule(e.target.value as typeof backupSchedule)}
          >
            <MenuItem value="DISABLED">Desativado</MenuItem>
            <MenuItem value="DAILY">Diário</MenuItem>
            <MenuItem value="WEEKLY">Semanal</MenuItem>
          </Select>
        </FormControl>

        {status === "error" && <Alert severity="error">{errorMessage}</Alert>}

        <Button variant="contained" size="large" onClick={handleSave} disabled={status === "starting"}>
          {status === "starting" ? "Iniciando backend local..." : "Salvar e iniciar backend local"}
        </Button>
      </Stack>
    </Box>
  );
}
