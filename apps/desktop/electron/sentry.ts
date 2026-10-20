// apps/desktop/electron/sentry.ts
// Fonte: fa-w5-desktop-crash-reporting-missing — rastreamento de crashes/erros do
// processo main e das janelas renderer do shell Electron.
// OPCIONAL de propósito, seguindo o MESMO padrão já usado em apps/api/src/lib/sentry.ts
// e apps/web/src/lib/sentry.ts: este sandbox/ambiente de dev/CI não tem um projeto
// Sentry real configurado. Sem `DESKTOP_SENTRY_DSN` definido, `initDesktopSentry()`
// apenas loga um aviso informativo e NUNCA chama `Sentry.init()` — toda chamada
// subsequente a `Sentry.captureException(...)` feita pelo resto do main process vira
// um no-op seguro. Isso garante que `npm run dev`/`npm run build`/empacotamento local
// nunca dependam de um DSN real para funcionar.
//
// EM PRODUÇÃO: defina a variável de ambiente `DESKTOP_SENTRY_DSN` (projeto Electron no
// Sentry) para habilitar de verdade — nenhuma outra mudança de código é necessária.
//
// Captura automática (sem nenhum código adicional em main.ts além de chamar
// `initDesktopSentry()` o mais cedo possível):
//  - Erros/exceptions não tratadas no processo main (via @sentry/node, integração
//    padrão do SDK).
//  - Crashes nativos (minidumps) do processo main E das janelas renderer
//    (launcherWindow/erpWindow) — captura de "renderer-process-gone"/"crashed" é uma
//    integração padrão do @sentry/electron, habilitada automaticamente ao chamar
//    `Sentry.init()` no main, sem precisar tocar em preload.ts/erp-preload.ts.
//  - Erros JavaScript dentro do próprio renderer do launcher (src/main.tsx chama
//    `@sentry/electron/renderer` init() quando `VITE_DESKTOP_SENTRY_DSN` está definido
//    no build) — o transporte até o main usa a `preloadInjectionIntegration` padrão do
//    SDK (injeta seu próprio preload adicional na sessão, não conflita com o preload
//    dedicado deste app, contextIsolation/sandbox-compatível).
import * as Sentry from "@sentry/electron/main";

let sentryEnabled = false;

/** Deve ser chamada uma única vez, o mais cedo possível em main.ts (antes de
 * `app.whenReady()`), para que a integração de crash nativo seja registrada antes de
 * qualquer `BrowserWindow` ser criada. */
export function initDesktopSentry(): void {
  const dsn = process.env.DESKTOP_SENTRY_DSN;
  if (!dsn) {
    console.info(
      "[sentry] DESKTOP_SENTRY_DSN não configurado — Sentry (rastreamento de erros/crashes " +
        "do shell desktop) desabilitado (no-op). Defina a variável de ambiente " +
        "DESKTOP_SENTRY_DSN em produção para habilitar.",
    );
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Amostragem de tracing conservadora por padrão — ajustável via env sem precisar
    // de novo build/instalador para subir/descer o volume enviado ao Sentry.
    tracesSampleRate: Number(process.env.DESKTOP_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
  sentryEnabled = true;
  console.info("[sentry] Sentry inicializado (processo main + crash reporting de renderers)");
}

export function isDesktopSentryEnabled(): boolean {
  return sentryEnabled;
}

export { Sentry };
