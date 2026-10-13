// apps/desktop/src/screens/WelcomeModeSelect.tsx
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import StorageIcon from "@mui/icons-material/Storage";
import ComputerIcon from "@mui/icons-material/Computer";
import type { InstallMode } from "../../electron/ipc-contract";

export function WelcomeModeSelect({ onChooseMode }: { onChooseMode: (mode: InstallMode) => void }) {
  return (
    <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
      <Stack spacing={4} sx={{ maxWidth: 760, width: "100%" }}>
        <Stack spacing={1} textAlign="center">
          <Typography variant="h4">Bem-vindo ao Filitech ERP Desktop</Typography>
          <Typography variant="body1" color="text.secondary">
            Como este PC vai funcionar na sua loja?
          </Typography>
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={3}>
          <Card variant="outlined" sx={{ flex: 1 }}>
            <CardActionArea onClick={() => onChooseMode("HOST")} sx={{ height: "100%", p: 1 }}>
              <CardContent>
                <StorageIcon color="primary" sx={{ fontSize: 40 }} />
                <Typography variant="h6" sx={{ mt: 1 }}>
                  Modo HOST (central)
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Este PC vai rodar o backend e o banco de dados localmente, servindo os outros
                  computadores/caixas da loja pela rede local. Escolha isto no computador
                  principal/servidor da loja.
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
          <Card variant="outlined" sx={{ flex: 1 }}>
            <CardActionArea onClick={() => onChooseMode("CLIENT")} sx={{ height: "100%", p: 1 }}>
              <CardContent>
                <ComputerIcon color="secondary" sx={{ fontSize: 40 }} />
                <Typography variant="h6" sx={{ mt: 1 }}>
                  Modo USUÁRIO (terminal)
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Este PC apenas se conecta ao computador em modo HOST da rede local. Escolha
                  isto nos caixas/terminais adicionais da loja.
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Stack>
      </Stack>
    </Box>
  );
}
