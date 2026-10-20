// apps/api/src/lib/brasilapi-client.ts
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 10): nenhuma chamada real à
// BrasilAPI existia — a validação de CNPJ era puramente matemática (dígito
// verificador, br-documents.ts), nunca confirmada contra o cadastro real da Receita
// Federal. Esta implementação consulta `GET /api/cnpj/v1/{cnpj}` da BrasilAPI
// (https://brasilapi.com.br — gratuita, sem autenticação, espelha dados públicos da
// Receita) para autopreencher razão social/nome fantasia/endereço no onboarding e
// alertar quando o CNPJ informado está com situação cadastral diferente de ATIVA.
import { isValidCnpj, normalizeCnpj } from "./br-documents";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("brasilapi-client");

const BRASILAPI_TIMEOUT_MS = 8_000;

export interface BrasilApiCnpjResult {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  descricao_situacao_cadastral: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  ddd_telefone_1: string | null;
}

export class InvalidCnpjFormatError extends Error {}
export class CnpjNotFoundError extends Error {}
export class BrasilApiUnavailableError extends Error {}

export async function lookupCnpj(rawCnpj: string): Promise<BrasilApiCnpjResult> {
  const cnpj = normalizeCnpj(rawCnpj);
  // A BrasilAPI ainda consulta exclusivamente o cadastro tradicional (14 dígitos
  // numéricos) da Receita Federal — o novo CNPJ alfanumérico (Capítulo 22, aceito
  // por `isValidCnpj` para fins de validação de dígito verificador) ainda não tem
  // cobertura pública de consulta cadastral em nenhum provedor no momento desta
  // implementação. Para CNPJs alfanuméricos, a consulta é pulada silenciosamente
  // (não é um erro do usuário) e o preenchimento continua manual.
  if (!/^\d{14}$/.test(cnpj) || !isValidCnpj(cnpj)) {
    throw new InvalidCnpjFormatError("CNPJ inválido ou em formato alfanumérico ainda não suportado por consulta automática.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRASILAPI_TIMEOUT_MS);
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) {
      // fa-w4-brasilapi-cnpj-in-error — a mensagem de erro antiga ecoava o CNPJ
      // completo de volta na resposta HTTP (`CNPJ ${cnpj} não encontrado...`), ou
      // seja, qualquer caller que repassasse `error.message` ao frontend (ou a um
      // provedor de observabilidade de terceiros) vazava de volta o documento que
      // o próprio usuário acabou de submeter. O CNPJ em si não é segredo (é
      // público na Receita Federal), mas não há motivo para devolvê-lo embutido no
      // texto de erro — mensagem agora é genérica; o CNPJ consultado fica só no
      // log estruturado do servidor (nunca chega à resposta HTTP).
      log.info({ cnpj }, "CNPJ não encontrado na Receita Federal via BrasilAPI");
      throw new CnpjNotFoundError("CNPJ não encontrado.");
    }
    if (!response.ok) {
      throw new BrasilApiUnavailableError(`BrasilAPI retornou HTTP ${response.status}.`);
    }
    return (await response.json()) as BrasilApiCnpjResult;
  } catch (err) {
    if (err instanceof CnpjNotFoundError || err instanceof InvalidCnpjFormatError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new BrasilApiUnavailableError("BrasilAPI não respondeu a tempo — tente novamente.");
    }
    throw new BrasilApiUnavailableError(`Falha ao consultar BrasilAPI: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}
