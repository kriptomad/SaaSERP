// apps/web/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ToastProvider } from "./shared/ui/Toast";
import { ThemeModeProvider } from "./theme/ThemeModeProvider";
import { registerServiceWorker } from "./shared/offline/register-service-worker";

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
