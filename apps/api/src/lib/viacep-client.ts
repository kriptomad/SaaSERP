// apps/api/src/lib/viacep-client.ts
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 10): nenhuma chamada real à
// ViaCEP existia no código — endereços eram sempre digitados manualmente, sem
// nenhum autopreenchimento, mesmo sendo uma API pública, gratuita e sem
// autenticação (https://viacep.com.br). Esta é a implementação real, com timeout
// defensivo (a ViaCEP não tem SLA formal e já teve incidentes de indisponibilidade)
// e normalização do "CEP não encontrado" (a ViaCEP responde HTTP 200 com
// `{ erro: true }` em vez de um 404, então um `res.ok` ingênuo não bastaria).
const VIACEP_TIMEOUT_MS = 5_000;

export interface ViaCepAddress {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
}

export class InvalidCepFormatError extends Error {}
export class CepNotFoundError extends Error {}
export class ViaCepUnavailableError extends Error {}

function normalizeCep(rawCep: string): string {
  return rawCep.replace(/\D/g, "");
}

export function isValidCepFormat(rawCep: string): boolean {
  return /^\d{8}$/.test(normalizeCep(rawCep));
}

export async function lookupCep(rawCep: string): Promise<ViaCepAddress> {
  const cep = normalizeCep(rawCep);
  if (!isValidCepFormat(cep)) {
    throw new InvalidCepFormatError("CEP inválido — informe 8 dígitos numéricos.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIACEP_TIMEOUT_MS);
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new ViaCepUnavailableError(`ViaCEP retornou HTTP ${response.status}.`);
    }
    const data = (await response.json()) as ViaCepAddress & { erro?: boolean };
    if (data.erro) {
      throw new CepNotFoundError(`CEP ${cep} não encontrado.`);
    }
    return data;
  } catch (err) {
    if (err instanceof CepNotFoundError || err instanceof InvalidCepFormatError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new ViaCepUnavailableError("ViaCEP não respondeu a tempo — tente novamente.");
    }
    throw new ViaCepUnavailableError(`Falha ao consultar ViaCEP: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}
