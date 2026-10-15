// apps/api/src/workers/personal-investment-quotes.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 22.6 — Patrimônio Líquido (Net Worth) e
// Mark-to-Market de Investimentos. GAP DE AUDITORIA FECHADO (mega-audit round 3,
// r3-personal-finance-brasilapi): até esta correção, `PersonalInvestment.currentPrice`
// só era atualizado manualmente via `PATCH /personal/investments/:id/price` — a
// atualização diária automática de cotação, citada em prosa no próprio capítulo,
// nunca foi implementada. Este worker varre diariamente todo `PersonalInvestment`
// com `ticker` preenchido e `assetType` em (`ACOES`, `FII`) — os únicos tipos para os
// quais existe fonte pública gratuita de cotação em tempo real (ver nota de desvio de
// provedor em `lib/brapi-client.ts`) — e grava o novo preço + um ponto idempotente em
// `PersonalInvestmentPriceHistory`, exatamente como a atualização manual já fazia.
// Os demais `assetType` (TESOURO_DIRETO, CDB, LCI_LCA, CRIPTO, PREVIDENCIA_PRIVADA,
// POUPANCA) permanecem com atualização manual — não existe fonte pública gratuita e
// confiável para todos eles, e fabricar uma cotação aproximada seria pior que não
// atualizar (dado financeiro errado é mais perigoso que dado desatualizado explícito).
import { Worker, Job } from "bullmq";
import { prismaUnscoped, Prisma } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, personalInvestmentQuotesQueue } from "../lib/queue";
import { fetchStockQuotes, BrapiUnavailableError } from "../lib/brapi-client";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("personal-investment-quotes.worker");

const REPEATABLE_JOB_NAME = "daily-quote-update";
// Após o fechamento do pregão da B3 (17h-18h horário de Brasília) — cotação de
// fechamento do dia, mesma convenção de "preço de fechamento diário" usada pela
// própria B3 e pelo Tesouro Direto. Horário em UTC (00h UTC = 21h BRT).
const DAILY_CRON_21H_BRT = "0 0 * * *";
// Lote máximo de tickers por requisição suportado pela brapi.dev.
const BATCH_SIZE = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function personalInvestmentQuotesProcessor(_job: Job): Promise<{ updated: number; failedBatches: number }> {
  const investments = await prismaUnscoped.personalInvestment.findMany({
    where: { assetType: { in: ["ACOES", "FII"] }, ticker: { not: null } },
    select: { id: true, ticker: true },
  });

  const tickerToInvestmentIds = new Map<string, string[]>();
  for (const investment of investments) {
    const ticker = investment.ticker!.trim().toUpperCase();
    if (!ticker) continue;
    const list = tickerToInvestmentIds.get(ticker) ?? [];
    list.push(investment.id);
    tickerToInvestmentIds.set(ticker, list);
  }

  const uniqueTickers = Array.from(tickerToInvestmentIds.keys());
  if (uniqueTickers.length === 0) {
    return { updated: 0, failedBatches: 0 };
  }

  const priceDate = new Date(new Date().toDateString());
  let updated = 0;
  let failedBatches = 0;

  for (const batch of chunk(uniqueTickers, BATCH_SIZE)) {
    let quotes;
    try {
      quotes = await fetchStockQuotes(batch);
    } catch (err) {
      // Falha de UM lote (ex.: brapi.dev fora do ar) não derruba os demais lotes nem
      // o job inteiro — os investimentos deste lote simplesmente mantêm o último
      // preço conhecido até a próxima execução diária.
      failedBatches += 1;
      log.error({ err: err instanceof BrapiUnavailableError ? err.message : err, batch }, "falha ao buscar cotações em lote — mantendo último preço conhecido");
      continue;
    }

    for (const quote of quotes) {
      const investmentIds = tickerToInvestmentIds.get(quote.ticker.toUpperCase());
      if (!investmentIds) continue;
      const currentPrice = new Prisma.Decimal(quote.regularMarketPrice.toFixed(2));

      for (const investmentId of investmentIds) {
        try {
          await prismaUnscoped.$transaction([
            prismaUnscoped.personalInvestment.update({ where: { id: investmentId }, data: { currentPrice } }),
            prismaUnscoped.personalInvestmentPriceHistory.upsert({
              where: { investmentId_priceDate: { investmentId, priceDate } },
              create: { investmentId, priceDate, closingPrice: currentPrice },
              update: { closingPrice: currentPrice },
            }),
          ]);
          updated += 1;
        } catch (err) {
          log.error({ err, investmentId, ticker: quote.ticker }, "falha ao gravar cotação individual — investimento pulado");
        }
      }
    }
  }

  return { updated, failedBatches };
}

export function startPersonalInvestmentQuotesWorker(): Worker {
  return new Worker(QUEUE_NAMES.PERSONAL_INVESTMENT_QUOTES, personalInvestmentQuotesProcessor, {
    connection: queueRedisConnection,
  });
}

export async function schedulePersonalInvestmentQuotesJob(): Promise<void> {
  await personalInvestmentQuotesQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_21H_BRT },
    { name: REPEATABLE_JOB_NAME },
  );
}
