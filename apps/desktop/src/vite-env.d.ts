/// <reference types="vite/client" />

interface ImportMetaEnv {
  // fa-w5-desktop-crash-reporting-missing — DSN do projeto Sentry Electron (renderer).
  // OPCIONAL: sem esta env var, src/main.tsx não chama `@sentry/electron/renderer`
  // init() (no-op seguro) — nunca quebra `vite build`/dev local. Defina em produção
  // (mesma variável de build que alimenta DESKTOP_SENTRY_DSN no processo main, ver
  // electron/sentry.ts e apps/desktop/.env.example) para habilitar de verdade.
  readonly VITE_DESKTOP_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
