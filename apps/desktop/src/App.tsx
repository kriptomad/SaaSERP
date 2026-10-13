// apps/desktop/src/App.tsx
// Orquestra o fluxo de onboarding do shell desktop: escolha de modo -> configuração
// específica do modo -> licenciamento -> dashboard (HOST) ou tela de abertura do ERP
// (CLIENT). Não é um app de negócio — é só o "instalador vivo" do Filitech ERP Desktop.
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { getDesktopApi, type DesktopConfig } from "./api/desktopApi";
import { WelcomeModeSelect } from "./screens/WelcomeModeSelect";
import { HostNetworkConfig } from "./screens/HostNetworkConfig";
import { ClientHostConfig } from "./screens/ClientHostConfig";
import { LicenseActivation } from "./screens/LicenseActivation";
import { HostDashboard } from "./screens/HostDashboard";
import { ClientLauncher } from "./screens/ClientLauncher";

type Step = "LOADING" | "MODE_SELECT" | "NETWORK_SETUP" | "LICENSE" | "MAIN";

export function App() {
  const [step, setStep] = useState<Step>("LOADING");
  const [config, setConfig] = useState<DesktopConfig | null>(null);

  useEffect(() => {
    getDesktopApi()
      .config.get()
      .then((loaded) => {
        setConfig(loaded);
        setStep(resolveInitialStep(loaded));
      });
  }, []);

  function resolveInitialStep(current: DesktopConfig): Step {
    if (!current.installMode) return "MODE_SELECT";
    if (current.installMode === "HOST" && !current.network.backupFolderPath) return "NETWORK_SETUP";
    if (current.installMode === "CLIENT" && !current.clientHost) return "NETWORK_SETUP";
    // `onboardingComplete` é marcado mesmo quando o lojista opta por "prosseguir sem
    // licença" (módulo de licenciamento ainda não publicado) — não reabre essa tela em
    // todo restart só porque `license` continua nulo.
    if (!current.license && !current.onboardingComplete) return "LICENSE";
    return "MAIN";
  }

  async function refreshConfig() {
    const api = getDesktopApi();
    const loaded = await api.config.get();
    setConfig(loaded);
    return loaded;
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
          await getDesktopApi().config.patch({ installMode: mode });
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
          await getDesktopApi().config.patch({ onboardingComplete: true });
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
