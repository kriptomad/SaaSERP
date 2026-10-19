// apps/desktop/src/screens/ClientLauncher.tsx
// Tela principal do modo USUÁRIO: abre a janela do ERP apontando para o HOST
// configurado, com atalho para reconfigurar o IP caso o PC central mude de endereço.
import { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import { getDesktopApi, type DesktopConfig } from "../api/desktopApi";

export function ClientLauncher({ config, onReconfigure }: { config: DesktopConfig; onReconfigure: () => void }) {
  const [checking, setChecking] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const host = config.clientHost!;
  const apiBaseUrl = `${host.useHttps ? "https" : "http"}://${host.host}:${host.port}`;

  async function handleOpen() {
    setChecking(true);
    try {
      const result = await getDesktopApi().network.pingUrl(`${apiBaseUrl}/health`);
      setReachable(result.ok);
    } catch {
      setReachable(false);
    } finally {
      setChecking(false);
    }
    // Abre mesmo se o host estiver inacessível: o PDV offline-first (Dexie + Service
    // Worker + Background Sync, apps/web/src/shared/offline) cobre a venda sem rede.
    await getDesktopApi().window.openErp();
  }

  return (
    <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
      <Stack spacing={3} sx={{ maxWidth: 480, width: "100%" }} alignItems="center" textAlign="center">
        <Typography variant="h5">Filitech ERP — Terminal</Typography>
        <Typography variant="body2" color="text.secondary">
          Conectado a {apiBaseUrl}
        </Typography>

        <Button variant="contained" size="large" onClick={handleOpen} disabled={checking} fullWidth>
          {checking ? <CircularProgress size={22} /> : "Abrir Filitech ERP"}
        </Button>

        {reachable === false && (
          <Alert severity="warning" sx={{ width: "100%" }}>
            PC central não respondeu agora. O app vai abrir mesmo assim — vendas feitas sem
            conexão ficam na fila offline e sincronizam automaticamente quando a rede voltar.
          </Alert>
        )}

        <Button variant="text" onClick={onReconfigure}>
          Trocar PC central / configurações de rede
        </Button>
      </Stack>
    </Box>
  );
}
