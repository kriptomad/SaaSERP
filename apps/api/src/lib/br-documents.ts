// apps/api/src/lib/br-documents.ts
// Validação real de CNPJ — cobre tanto o formato numérico tradicional (14 dígitos)
// quanto o novo CNPJ ALFANUMÉRICO da Receita Federal (Nota Técnica 2025.002,
// convivência a partir de julho/2026): os 12 primeiros caracteres podem ser letras
// MAIÚSCULAS (A-Z) ou dígitos, e os 2 dígitos verificadores finais continuam
// sempre numéricos. O algoritmo de cálculo dos dígitos verificadores é o mesmo
// módulo 11 de sempre, mas em vez de usar o dígito numérico de cada posição, usa o
// valor "charCode - 48" de cada caractere — que para um dígito '0'-'9' (códigos
// 48-57) dá exatamente o valor numérico de sempre (0-9), e para uma letra 'A'-'Z'
// (códigos 65-90) dá 17-42. Isso faz o mesmo algoritmo validar os dois formatos
// sem nenhuma ramificação — um CNPJ 100% numérico é apenas o caso particular em
// que nenhum caractere cai no intervalo de letras.
const CNPJ_WEIGHTS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function charValue(ch: string): number {
  return ch.charCodeAt(0) - 48;
}

function calcCheckDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += charValue(base[i]) * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Remove máscara (pontos/traço/barra) e normaliza para maiúsculas — aceita tanto o CNPJ já formatado quanto só os caracteres. */
export function normalizeCnpj(raw: string): string {
  return raw.trim().toUpperCase().replace(/[.\-/]/g, "");
}

/**
 * Valida um CNPJ (numérico tradicional OU alfanumérico novo formato) pelo
 * algoritmo oficial de dígito verificador módulo 11. Rejeita sequências
 * triviais (todos os caracteres iguais, ex. "00000000000000"), que passariam no
 * cálculo de módulo 11 mas nunca são um CNPJ real emitido.
 */
export function isValidCnpj(raw: string): boolean {
  const cleaned = normalizeCnpj(raw);
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cleaned)) return false;
  if (/^(.)\1{13}$/.test(cleaned)) return false;

  const base = cleaned.slice(0, 12);
  const providedDv = cleaned.slice(12, 14);
  const dv1 = calcCheckDigit(base, CNPJ_WEIGHTS_DV1);
  const dv2 = calcCheckDigit(base + dv1, CNPJ_WEIGHTS_DV2);

  return providedDv === `${dv1}${dv2}`;
}
