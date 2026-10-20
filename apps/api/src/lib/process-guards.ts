// apps/api/src/lib/process-guards.ts
// Fonte: fa-w4-obs-no-crash-handlers-server / fa-w4-obs-no-crash-handlers-worker —
// rede de segurança de último nível para os dois processos Node deste serviço
// (API HTTP em server.ts, workers BullMQ em worker.ts). Sem isto, uma exceção
// síncrona não capturada por nenhum try/catch (ex.: bug num callback de terceiros)
// ou uma Promise rejeitada sem `.catch` em QUALQUER lugar do código matava o
// processo (uncaughtException) ou o deixava "zumbi" sem nenhum log estruturado
// (unhandledRejection) — nos dois casos, sem nenhuma pista pro operador nem
// qualquer sinal para o orquestrador (Railway/K8s/Docker) agir.
import { logger } from "./logger";
import { Sentry, isSentryEnabled } from "./sentry";

// Tempo dado ao pino/Sentry para terminarem de escrever/enviar antes do `exit` —
// pino é assíncrono por padrão (stream não bloqueante) e o transporte do Sentry
// despacha em rede; sem este respiro, a última linha de log mais importante do
// processo (o motivo real do crash) podia nunca chegar a sair antes do `exit(1)`.
const EXIT_FLUSH_DELAY_MS = 250;

export function installProcessCrashGuards(serviceName: string): void {
  process.on("uncaughtException", (err) => {
    logger.fatal(
      { err, service: serviceName },
      "uncaughtException — processo pode estar em estado corrompido (memória/locks/conexões " +
        "indefinidos); encerrando para o orquestrador reiniciar um processo limpo",
    );
    if (isSentryEnabled()) {
      Sentry.captureException(err);
    }
    // `uncaughtException` indica que o processo pode estar em estado inconsistente
    // — SEMPRE sai, nunca tenta "continuar" depois disto (diferente de
    // unhandledRejection abaixo). O orquestrador (restartPolicy do railway.toml /
    // K8s) sobe um processo novo e limpo no lugar.
    setTimeout(() => process.exit(1), EXIT_FLUSH_DELAY_MS).unref();
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.fatal({ err, service: serviceName }, "unhandledRejection — promise rejeitada sem nenhum .catch no código");
    if (isSentryEnabled()) {
      Sentry.captureException(err);
    }
    // DECISÃO DELIBERADA: não força `process.exit` aqui. A grande maioria das
    // rejeições não tratadas neste código-base vem de um `.catch` específico que
    // esqueceu de cobrir um caso (ex.: uma nova chamada assíncrona adicionada sem
    // o `.catch(err => log.error(...))` de praxe do resto do código) — o estado do
    // processo em si continua consistente (nenhuma transação de banco fica aberta
    // pela metade, nenhum lock fica preso), diferente de uma exceção síncrona no
    // meio de uma operação. Derrubar o processo inteiro por uma única promise não
    // tratada tiraria TODOS os tenants do ar por um bug isolado e normalmente
    // recuperável. Por isso fica só FATAL no log (e no Sentry, se configurado)
    // para investigação imediata — se no futuro isto se mostrar insuficiente
    // (rejeições em série indicando corrupção real do processo), reavaliar.
  });
}
