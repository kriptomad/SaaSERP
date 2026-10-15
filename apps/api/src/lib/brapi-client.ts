// apps/api/src/lib/brapi-client.ts
// GAP DE AUDITORIA FECHADO (mega-audit round 3, r3-personal-finance-brasilapi):
// BIBLE_ENGINEERING_V2.md Capítulo 22.6/22.10 prometia "atualização diária automática
// de cotação de ações/FIIs via BrasilAPI" (nota de pendência explícita no próprio
// texto do capítulo), mas a BrasilAPI (https://brasilapi.com.br) NUNCA teve endpoint
// de cotação de ações/FIIs — ela cobre CNPJ, CEP, bancos, feriados, câmbio e taxas
// (SELIC/CDI/IPCA), nunca preço de ticker de bolsa. Pesquisa de mercado confirma que
// a fonte pública gratuita real para isso é a brapi.dev (mesmo ecossistema de APIs
// brasileiras abertas, mesma filosofia "sem necessidade de scraping manual"), cujo
// endpoint `/api/quote/{tickers}` devolve `regularMarketPrice` em tempo real da B3.
// Mantemos o nome do arquivo alinhado à fonte real para não enganar o próximo leitor
// do código, e documentamos aqui — nunca silenciosamente — o motivo do desvio do
// provedor citado em prosa no Bible.
const BRAPI_TIMEOUT_MS = 8_000;
const BRAPI_BASE_URL = "https://brapi.dev/api/quote";
// Token opcional: a brapi.dev funciona sem autenticação para poucos tickers por
// requisição com limite de taxa mais apertado; `BRAPI_API_TOKEN` (plano gratuito
// cadastrável) eleva o limite — nunca obrigatório para o worker funcionar.
const BRAPI_TOKEN = process.env.BRAPI_API_TOKEN;

export class BrapiUnavailableError extends Error {}

export interface BrapiQuoteResult {
  ticker: string;
  regularMarketPrice: number;
}

// Busca cotação em lote (a brapi.dev aceita até 10 tickers por requisição separados
// por vírgula) — falhas de tickers individuais (deslistados, nome incorreto) não
// derrubam o lote inteiro: a resposta da brapi.dev já isola erros por ticker em
// `results[]`/omite o ticker inválido, nunca lança HTTP 4xx para um lote parcialmente
// válido.
export async function fetchStockQuotes(tickers: string[]): Promise<BrapiQuoteResult[]> {
  if (tickers.length === 0) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRAPI_TIMEOUT_MS);
  try {
    const url = new URL(`${BRAPI_BASE_URL}/${tickers.join(",")}`);
    if (BRAPI_TOKEN) url.searchParams.set("token", BRAPI_TOKEN);
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new BrapiUnavailableError(`brapi.dev retornou HTTP ${response.status}.`);
    }
    const body = (await response.json()) as { results?: Array<{ symbol: string; regularMarketPrice: number | null }> };
    return (body.results ?? [])
      .filter((r) => typeof r.regularMarketPrice === "number")
      .map((r) => ({ ticker: r.symbol, regularMarketPrice: r.regularMarketPrice as number }));
  } catch (err) {
    if (err instanceof BrapiUnavailableError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new BrapiUnavailableError("brapi.dev não respondeu a tempo — tente novamente.");
    }
    throw new BrapiUnavailableError(`Falha ao consultar brapi.dev: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}
