// apps/web/src/shared/validation/br-documents.ts
// Espelha apps/api/src/lib/br-documents.ts no frontend, para dar feedback
// imediato (sem round-trip ao servidor) tanto para o CNPJ numérico tradicional
// quanto para o novo formato ALFANUMÉRICO da Receita Federal (convivência a
// partir de jul/2026). Ver o arquivo backend para a explicação completa do
// algoritmo (charCode - 48 cobre dígitos e letras A-Z uniformemente).
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

export function normalizeCnpj(raw: string): string {
  return raw.trim().toUpperCase().replace(/[.\-/]/g, "");
}

/** Aplica a máscara visual XX.XXX.XXX/XXXX-XX enquanto o usuário digita (funciona com letras ou dígitos). */
export function formatCnpjMask(raw: string): string {
  const cleaned = normalizeCnpj(raw).slice(0, 14);
  const parts = [
    cleaned.slice(0, 2),
    cleaned.slice(2, 5),
    cleaned.slice(5, 8),
    cleaned.slice(8, 12),
    cleaned.slice(12, 14),
  ];
  let out = parts[0];
  if (parts[1]) out += `.${parts[1]}`;
  if (parts[2]) out += `.${parts[2]}`;
  if (parts[3]) out += `/${parts[3]}`;
  if (parts[4]) out += `-${parts[4]}`;
  return out;
}

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
