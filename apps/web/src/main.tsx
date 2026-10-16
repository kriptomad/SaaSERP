// apps/web/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ToastProvider } from "./shared/ui/Toast";
import { ThemeModeProvider } from "./theme/ThemeModeProvider";
import { registerServiceWorker } from "./shared/offline/register-service-worker";

// Blindagem contra inspeção via F12 em produção (Capítulo 3/9 — nunca vazar árvore de
// componentes/props/state pela extensão React DevTools, que funciona independente de
// minificação/ofuscação do bundle, pois lê a árvore de fibers em runtime via este hook
// global). Em dev mantemos o hook intacto para não quebrar o fluxo normal de depuração.
if (import.meta.env.PROD) {
  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Record<string, unknown> }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook) {
    for (const key of Object.keys(hook)) {
      hook[key] = typeof hook[key] === "function" ? () => undefined : hook[key];
    }
  }
}

registerServiceWorker();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// Temas claro/escuro vêm de @filitech/design-tokens (Bible 8.4.1) via ThemeModeProvider.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeModeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeModeProvider>
  </StrictMode>,
);
