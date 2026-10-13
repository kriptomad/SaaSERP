// Espelha apps/api/src/lib/scale-barcode.ts (Capítulo 4.1/20.7 — balanças de checkout
// Toledo/Filizola, EAN-13 de peso variável com prefixo "2", padrão GS1 Brasil). O PDV
// Offline-First (Capítulo 8.3) precisa decodificar o peso SEM round-trip à API — o
// terminal pode estar sem internet exatamente quando o cliente está na fila do caixa —
// então a mesma lógica de decodificação roda aqui, no cliente, contra o catálogo Dexie
// já sincronizado (nunca confiando em nenhum preço eventualmente embutido no payload).
export interface DecodedScaleBarcode {
  internalCode: string;
  weightKg: number;
}

function isValidEan13CheckDigit(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(digits[i]);
    sum += i % 2 === 0 ? n : n * 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(digits[12]);
}

export function decodeScaleBarcode(barcode: string): DecodedScaleBarcode | null {
  if (!/^2\d{12}$/.test(barcode)) return null;
  if (!isValidEan13CheckDigit(barcode)) return null;

  const internalCode = barcode.slice(1, 6);
  const weightGrams = Number(barcode.slice(6, 11));
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null;

  return { internalCode, weightKg: weightGrams / 1000 };
}
