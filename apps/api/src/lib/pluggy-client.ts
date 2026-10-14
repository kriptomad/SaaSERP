// apps/api/src/lib/pluggy-client.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.4.1 (Open Finance empresarial) e 22.5
// (Open Finance pessoal) — cliente real da API da Pluggy (agregador Open Finance
// homologado pelo Banco Central), contrato verificado em docs.pluggy.ai (2026-10-14):
//
//   • Auth:          POST https://api.pluggy.ai/auth  { clientId, clientSecret }
//                    -> { apiKey: string } — expira em 2 HORAS (documentado em
//                    docs.pluggy.ai/docs/authentication: "This API Key expires after
//                    2 hours"). O `apiKey` é enviado em toda chamada subsequente no
//                    header `X-API-KEY`.
//   • Accounts:      GET https://api.pluggy.ai/accounts?itemId={itemId}
//                    -> { results: PluggyAccount[] } — docs.pluggy.ai/docs/products/accounts.
//                    Campos confirmados: id, type (BANK|CREDIT), subtype
//                    (CHECKING_ACCOUNT|SAVINGS_ACCOUNT|CREDIT_CARD), number, name,
//                    balance, itemId, currencyCode.
//   • Transactions:  GET https://api.pluggy.ai/transactions?accountId={id}&from=YYYY-MM-DD
//                    &to=YYYY-MM-DD&page=N&pageSize=500 -> { results, page, totalPages,
//                    total } — docs.pluggy.ai/docs/products/transactions. Este endpoint
//                    está marcado como "deprecated" em favor de `/v2/transactions`
//                    (cursor-based), mas continua documentado, funcional e é o único
//                    com contrato de página/parâmetros publicamente especificado no
//                    momento desta implementação — usado aqui deliberadamente em vez
//                    de inventar parâmetros de cursor não documentados.
//   • Webhooks:      a Pluggy NÃO assina/autentica requisições de webhook (nenhum
//                    header de HMAC documentado, ao contrário de Stripe/iFood neste
//                    mesmo código) — ver nota completa em `pluggy-webhook.routes.ts`.
//
// Cache do `apiKey` em memória com expiração e invalidação por fingerprint de
// credencial, mesmo padrão de `object-storage.ts`/`stripe.client.ts` (evita logar em
// toda chamada, mas nunca serve um apiKey após a troca de clientId/clientSecret pelo
// painel admin).
import { getPlatformSecret } from "./platform-secrets";

const PLUGGY_API_BASE_URL = "https://api.pluggy.ai";
// Margem de segurança: a Pluggy documenta expiração de exatamente 2h; renovamos 5
// minutos antes para nunca arriscar usar um apiKey expirado em uma chamada em voo.
const API_KEY_SAFETY_MARGIN_MS = 5 * 60 * 1000;
const API_KEY_TTL_MS = 2 * 60 * 60 * 1000 - API_KEY_SAFETY_MARGIN_MS;
const TRANSACTIONS_PAGE_SIZE = 500; // máximo documentado pela Pluggy para o endpoint legado de transações.

export interface PluggyAccount {
  id: string;
  type: "BANK" | "CREDIT";
  subtype: "CHECKING_ACCOUNT" | "SAVINGS_ACCOUNT" | "CREDIT_CARD" | string;
  number: string;
  name: string;
  marketingName?: string | null;
  balance: number;
  itemId: string;
  currencyCode: string;
}

export interface PluggyTransaction {
  id: string;
  accountId: string;
  date: string; // ISO8601 (UTC)
  description: string;
  descriptionRaw?: string | null;
  amount: number; // positivo = crédito, negativo = débito (conta BANK); sinal invertido em CREDIT
  category?: string | null;
  status?: "PENDING" | "POSTED" | string;
}

interface PluggyTransactionsPage {
  results: PluggyTransaction[];
  page: number;
  totalPages: number;
  total: number;
}

interface PluggyConfig {
  clientId: string;
  clientSecret: string;
}

async function loadPluggyConfig(): Promise<PluggyConfig> {
  const [clientId, clientSecret] = await Promise.all([
    getPlatformSecret("PLUGGY_CLIENT_ID"),
    getPlatformSecret("PLUGGY_CLIENT_SECRET"),
  ]);
  if (!clientId || !clientSecret) {
    throw new Error(
      "Pluggy não configurado — defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET em Painel Admin → Infraestrutura (grupo Open Finance (Pluggy)) ou nas variáveis de ambiente correspondentes.",
    );
  }
  return { clientId, clientSecret };
}

// Cache de apiKey em memória — invalidado automaticamente quando clientId/clientSecret
// mudam via painel admin (fingerprint), igual ao padrão de `object-storage.ts`.
let cachedApiKey: string | null = null;
let cachedFingerprint: string | null = null;
let cachedExpiresAt = 0;

async function fetchFreshApiKey(config: PluggyConfig): Promise<string> {
  const response = await fetch(`${PLUGGY_API_BASE_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ao autenticar na Pluggy (POST /auth): HTTP ${response.status} ${body}`.trim());
  }
  const data = (await response.json()) as { apiKey?: string };
  if (!data.apiKey) {
    throw new Error("Resposta de POST /auth da Pluggy não trouxe o campo apiKey esperado.");
  }
  return data.apiKey;
}

async function getApiKey(): Promise<string> {
  const config = await loadPluggyConfig();
  const fingerprint = `${config.clientId}:${config.clientSecret}`;
  const now = Date.now();
  if (cachedApiKey && cachedFingerprint === fingerprint && now < cachedExpiresAt) {
    return cachedApiKey;
  }
  const apiKey = await fetchFreshApiKey(config);
  cachedApiKey = apiKey;
  cachedFingerprint = fingerprint;
  cachedExpiresAt = now + API_KEY_TTL_MS;
  return apiKey;
}

async function pluggyGet<T>(path: string): Promise<T> {
  const apiKey = await getApiKey();
  const response = await fetch(`${PLUGGY_API_BASE_URL}${path}`, {
    method: "GET",
    headers: { "X-API-KEY": apiKey, Accept: "application/json" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Chamada à Pluggy falhou (GET ${path}): HTTP ${response.status} ${body}`.trim());
  }
  return (await response.json()) as T;
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Contas vinculadas a um Item (conexão) já sincronizado pela Pluggy (Capítulo 17.4.1/22.5). */
export async function fetchPluggyAccounts(itemId: string): Promise<PluggyAccount[]> {
  const page = await pluggyGet<{ results: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`);
  return page.results;
}

/**
 * Transações de uma conta no intervalo [from, to], paginando todas as páginas
 * documentadas (até 500 por página) — nunca devolve apenas a primeira página.
 */
export async function fetchPluggyTransactions(accountId: string, from: Date, to: Date): Promise<PluggyTransaction[]> {
  const fromYmd = toYmd(from);
  const toYmdStr = toYmd(to);
  const all: PluggyTransaction[] = [];
  let page = 1;
  // Laço de paginação com teto defensivo (não confia cegamente em `totalPages` de
  // uma resposta corrompida/infinita vinda de uma API externa).
  for (let guard = 0; guard < 500; guard += 1) {
    const result = await pluggyGet<PluggyTransactionsPage>(
      `/transactions?accountId=${encodeURIComponent(accountId)}&from=${fromYmd}&to=${toYmdStr}&page=${page}&pageSize=${TRANSACTIONS_PAGE_SIZE}`,
    );
    all.push(...result.results);
    if (page >= result.totalPages || result.results.length === 0) break;
    page += 1;
  }
  return all;
}

/** Teste de conexão real usado pela rota `test-pluggy` do painel admin (POST /auth de verdade, nunca simulado). */
export async function testPluggyConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const config = await loadPluggyConfig();
    const apiKey = await fetchFreshApiKey(config);
    cachedApiKey = apiKey;
    cachedFingerprint = `${config.clientId}:${config.clientSecret}`;
    cachedExpiresAt = Date.now() + API_KEY_TTL_MS;
    return { success: true, message: "Autenticação Pluggy confirmada (POST /auth retornou apiKey válido)." };
  } catch (error) {
    return { success: false, message: `Falha ao autenticar na Pluggy: ${(error as Error).message}` };
  }
}
