/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  // fa-w4-obs-no-error-tracking-apm — DSN do projeto Sentry do frontend. OPCIONAL:
  // sem esta env var, `initSentry()` (src/lib/sentry.ts) não inicializa nada (no-op
  // seguro) — nunca quebra `vite build`/dev local. Defina em produção (Vercel) para
  // habilitar rastreamento de erros/APM do React.
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
