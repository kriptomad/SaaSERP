// apps/api/src/lib/sentry.ts
// Fonte: fa-w4-obs-no-error-tracking-apm — rastreamento de erros/APM (Sentry).
// OPCIONAL de propósito: este sandbox/ambiente de dev/CI NÃO tem um projeto Sentry
// real configurado. Sem `SENTRY_DSN` definido, `initSentry()` apenas loga um aviso
// informativo e NUNCA chama `Sentry.init()` — toda chamada subsequente a
// `Sentry.captureException(...)` feita pelo resto do código vira um no-op seguro
// (o SDK, sem client inicializado, não lança nem tenta nenhuma chamada de rede).
// Isso garante que `npm run dev`/`npm test`/build local nunca dependam de um DSN
// real para funcionar.
//
// EM PRODUÇÃO: defina a variável de ambiente `SENTRY_DSN` (projeto Node/Express no
// Sentry) para habilitar de verdade — nenhuma outra mudança de código é necessária.
import * as Sentry from "@sentry/node";
import { logger } from "./logger";

let sentryEnabled = false;

/** Deve ser chamada uma única vez, o mais cedo possível na inicialização do
 * processo (server.ts/worker.ts) — mas é segura mesmo que chamada depois de outros
 * módulos já terem sido importados, pois não dependemos aqui de auto-instrumentação
 * via patch de módulo (ver `Sentry.setupExpressErrorHandler` em server.ts, que é
 * middleware explícito, não instrumentação automática sensível a ordem de import). */
export function initSentry(serviceName: string): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info(
      { service: serviceName },
      "SENTRY_DSN não configurado — Sentry (rastreamento de erros/APM) desabilitado (no-op). " +
        "Defina a variável de ambiente SENTRY_DSN em produção para habilitar.",
    );
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    serverName: serviceName,
    // Amostragem de tracing conservadora por padrão — ajustável via env sem
    // precisar de novo deploy para subir/descer o volume enviado ao Sentry.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
  sentryEnabled = true;
  logger.info({ service: serviceName }, "Sentry inicializado");
}

export function isSentryEnabled(): boolean {
  return sentryEnabled;
}

export { Sentry };
