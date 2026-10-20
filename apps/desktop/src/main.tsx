// apps/desktop/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { createAppTheme } from "@filitech/design-tokens";
import { App } from "./App";

// CORREÇÃO DE AUDITORIA (fa-w5-desktop-crash-reporting-missing): captura de erros
// JavaScript não tratados dentro desta janela (launcher/onboarding). Mesmo padrão
// opcional/no-op de apps/web/src/lib/sentry.ts: sem `VITE_DESKTOP_SENTRY_DSN` definido
// no build (sandbox/dev local), `init()` não é chamado — nenhuma dependência de rede,
// nenhum impacto no boot. O transporte até o processo main usa a
// `preloadInjectionIntegration` padrão do `@sentry/electron`, que injeta seu próprio
// preload adicional (sandbox/contextIsolation-compatível), sem precisar tocar em
// `electron/preload.ts`.
import * as DesktopSentry from "@sentry/electron/renderer";
if (import.meta.env.VITE_DESKTOP_SENTRY_DSN) {
  DesktopSentry.init();
}

// Reaproveita o mesmo motor de tema (tokens de marca) do produto web — não um tema
// desktop paralelo — via @filitech/design-tokens (pacote compartilhado do monorepo).
const theme = createAppTheme("light");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);

