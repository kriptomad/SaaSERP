// apps/web/src/lib/sentry.ts
// Fonte: fa-w4-obs-no-error-tracking-apm — rastreamento de erros/APM do frontend.
// OPCIONAL de propósito: sem `VITE_SENTRY_DSN` definido no ambiente de build (este
// sandbox/dev local não tem um projeto Sentry real), `initSentry()` só loga um aviso
// no console e NUNCA chama `Sentry.init()` — toda chamada subsequente a
// `Sentry.captureException(...)` (ex.: dentro do ErrorBoundary, ver
// shared/ui/ErrorBoundary.tsx) vira um no-op seguro, sem travar o app nem o build.
//
// EM PRODUÇÃO: defina `VITE_SENTRY_DSN` nas variáveis de ambiente de build para
// habilitar de verdade — nenhuma outra mudança de código é necessária.
import * as Sentry from "@sentry/react";

let sentryEnabled = false;

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info(
        "[sentry] VITE_SENTRY_DSN não configurado — Sentry (rastreamento de erros/APM do frontend) desabilitado (no-op).",
      );
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Amostragem conservadora por padrão — ajustável sem novo deploy de código.
    tracesSampleRate: 0.1,
  });
  sentryEnabled = true;
}

export function isSentryEnabled(): boolean {
  return sentryEnabled;
}

export { Sentry };
