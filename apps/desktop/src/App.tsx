// apps/desktop/src/App.tsx
// Orquestra o fluxo de onboarding do shell desktop: escolha de modo -> configuração
// específica do modo -> licenciamento -> dashboard (HOST) ou tela de abertura do ERP
// (CLIENT). Não é um app de negócio — é só o "instalador vivo" do Filitech ERP Desktop.
import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { getDesktopApi, type DesktopConfig } from "./api/desktopApi";
import { WelcomeModeSelect } from "./screens/WelcomeModeSelect";
import { HostNetworkConfig } from "./screens/HostNetworkConfig";
import { ClientHostConfig } from "./screens/ClientHostConfig";
import { LicenseActivation } from "./screens/LicenseActivation";
import { HostDashboard } from "./screens/HostDashboard";
import { ClientLauncher } from "./screens/ClientLauncher";

type Step = "LOADING" | "LOAD_ERROR" | "MODE_SELECT" | "NETWORK_SETUP" | "LICENSE" | "MAIN";

export function App() {
  const [step, setStep] = useState<Step>("LOADING");
  const [config, setConfig] = useState<DesktopConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // CORREÇÃO DE AUDITORIA (fa-desktop-launcher-infinite-loading): `config.get()` sem
  // `.catch` deixava `step` preso em "LOADING" para sempre se o IPC/preload/store
  // falhasse (ex. store corrompido, preload não carregado). Agora qualquer rejeição
  // leva a uma tela de erro explícita com botão de "Tentar novamente".
  const loadConfig = useCallback(() => {
    setStep("LOADING");
    setLoadError(null);
    getDesktopApi()
      .config.get()
      .then((loaded) => {
        setConfig(loaded);
        setStep(resolveInitialStep(loaded));
      })
      .catch((error: unknown) => {
        console.error("[App] falha ao carregar config inicial", error);
        setLoadError(error instanceof Error ? error.message : "Falha desconhecida ao carregar a configuração do shell desktop.");
        setStep("LOAD_ERROR");
      });
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  function resolveInitialStep(current: DesktopConfig): Step {
    if (!current.installMode) return "MODE_SELECT";
    if (current.installMode === "HOST" && !current.network.backupFolderPath) return "NETWORK_SETUP";
    if (current.installMode === "CLIENT" && !current.clientHost) return "NETWORK_SETUP";
    // CORREÇÃO DE AUDITORIA (fa-desktop-bypass-no-license): não existe mais um caminho
    // de "prosseguir sem licença" — `onboardingComplete` sozinho nunca basta para
    // chegar em MAIN; o main process também recusa marcar `onboardingComplete` sem
    // `license` presente (ver CONFIG_SET_ONBOARDING_COMPLETE em electron/main.ts).
    if (!current.license) return "LICENSE";
    return "MAIN";
  }

  async function refreshConfig() {
    const api = getDesktopApi();
    const loaded = await api.config.get();
    setConfig(loaded);
    return loaded;
  }

  if (step === "LOAD_ERROR") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", p: 4 }}>
        <Stack spacing={2} sx={{ maxWidth: 480 }} alignItems="center" textAlign="center">
          <Typography variant="h6">Não foi possível carregar o Filitech ERP Desktop</Typography>
          <Alert severity="error" sx={{ width: "100%" }}>
            {loadError}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Se o problema persistir, contate o suporte informando esta mensagem.
          </Typography>
          <Button variant="contained" onClick={loadConfig}>
            Tentar novamente
          </Button>
        </Stack>
      </Box>
    );
  }

  if (step === "LOADING" || !config) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (step === "MODE_SELECT") {
    return (
      <WelcomeModeSelect
        onChooseMode={async (mode) => {
          await getDesktopApi().config.setInstallMode(mode);
          await refreshConfig();
          setStep("NETWORK_SETUP");
        }}
      />
    );
  }

  if (step === "NETWORK_SETUP") {
    if (config.installMode === "HOST") {
      return (
        <HostNetworkConfig
          config={config}
          onComplete={async () => {
            const refreshed = await refreshConfig();
            setStep(refreshed.license ? "MAIN" : "LICENSE");
          }}
        />
      );
    }
    return (
      <ClientHostConfig
        config={config}
        onComplete={async () => {
          const refreshed = await refreshConfig();
          setStep(refreshed.license ? "MAIN" : "LICENSE");
        }}
      />
    );
  }

  if (step === "LICENSE") {
    return (
      <LicenseActivation
        onComplete={async () => {
          await getDesktopApi().config.setOnboardingComplete();
          await refreshConfig();
          setStep("MAIN");
        }}
      />
    );
  }

  return config.installMode === "HOST" ? (
    <HostDashboard config={config} />
  ) : (
    <ClientLauncher config={config} onReconfigure={() => setStep("NETWORK_SETUP")} />
  );
}
