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

// fa-w6-obs-unhandled-rejection-no-threshold — uma única `unhandledRejection`
// isolada continua só logada (ver decisão abaixo), mas uma RÁFAGA delas dentro de
// uma janela curta é um sinal qualitativamente diferente: não é "um `.catch`
// esquecido pontual", é o processo inteiro degradando (ex.: pool de conexões do
// Postgres/Redis esgotado, dependência externa fora do ar derrubando toda chamada
// em paralelo) — nesse caso, continuar "zumbi" é pior do que reiniciar limpo.
const UNHANDLED_REJECTION_BURST_THRESHOLD = 5;
const UNHANDLED_REJECTION_BURST_WINDOW_MS = 60_000;
let unhandledRejectionTimestamps: number[] = [];

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
    // DECISÃO DELIBERADA: não força `process.exit` numa ocorrência ISOLADA. A
    // grande maioria das rejeições não tratadas neste código-base vem de um
    // `.catch` específico que esqueceu de cobrir um caso (ex.: uma nova chamada
    // assíncrona adicionada sem o `.catch(err => log.error(...))` de praxe do
    // resto do código) — o estado do processo em si continua consistente (nenhuma
    // transação de banco fica aberta pela metade, nenhum lock fica preso),
    // diferente de uma exceção síncrona no meio de uma operação. Derrubar o
    // processo inteiro por uma única promise não tratada tiraria TODOS os tenants
    // do ar por um bug isolado e normalmente recuperável. Por isso fica só FATAL
    // no log (e no Sentry, se configurado) para investigação imediata.
    //
    // fa-w6-obs-unhandled-rejection-no-threshold: mas uma RÁFAGA indica o
    // contrário — janela deslizante de timestamps (array simples, sem dependência
    // nova) descarta entradas fora de `UNHANDLED_REJECTION_BURST_WINDOW_MS` a cada
    // ocorrência; se mais de `UNHANDLED_REJECTION_BURST_THRESHOLD` caírem dentro da
    // janela, trata como `uncaughtException` (mesmo encerramento gracioso) — o
    // orquestrador reinicia um processo limpo em vez de deixar o processo
    // degradado indefinidamente.
    const now = Date.now();
    unhandledRejectionTimestamps = unhandledRejectionTimestamps.filter(
      (timestamp) => now - timestamp <= UNHANDLED_REJECTION_BURST_WINDOW_MS,
    );
    unhandledRejectionTimestamps.push(now);

    if (unhandledRejectionTimestamps.length > UNHANDLED_REJECTION_BURST_THRESHOLD) {
      logger.fatal(
        {
          service: serviceName,
          count: unhandledRejectionTimestamps.length,
          windowMs: UNHANDLED_REJECTION_BURST_WINDOW_MS,
        },
        "ALERTA: rajada de unhandledRejection acima do limite na janela — processo provavelmente em " +
          "estado degradado (não um bug isolado); encerrando para o orquestrador reiniciar um processo limpo",
      );
      unhandledRejectionTimestamps = [];
      setTimeout(() => process.exit(1), EXIT_FLUSH_DELAY_MS).unref();
    }
  });
}
