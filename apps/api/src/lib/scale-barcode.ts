// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.1 ("Balanças de checkout (Toledo/Filizola):
// integração serial decodificando o payload de peso embutido no EAN-13 interno
// (prefixo 2)") e Capítulo 20.7 ("o peso lido é injetado no formulário de venda ao
// escanear um EAN-13 de peso variável (prefixo 2, conforme padrão GS1 Brasil)").
//
// GAP DE AUDITORIA (Rodada 4): nenhum ponto do código (API ou frontend) decodificava
// esse payload — o PDV só comparava o código de barras lido por igualdade estrita
// (`p.barcode === search`), então um produto pesável escaneado na balança nunca era
// localizado nem tinha a quantidade calculada automaticamente a partir do peso.
//
// Formato real do EAN-13 de peso variável (padrão GS1 Brasil, prefixo interno "2"):
//   dígito 0:        "2" (flag de peso variável)
//   dígitos 1-5:     código interno do produto (5 dígitos, cadastrado em Product.barcode)
//   dígitos 6-10:    peso em gramas (5 dígitos)
//   dígito 11:       dígito de controle do peso (não usado para price lookup — ignorado)
//   dígito 12:       dígito verificador EAN-13 padrão
//
// Nunca confiamos em nenhum preço eventualmente embutido no payload — a Bible já
// documenta `unitPrice` vindo do cliente como vetor de adulteração (Capítulo 6.6,
// pendência da Rodada 1); aqui extraímos apenas o PESO, e o preço final é sempre
// recalculado a partir de `Product.unitPrice`, já validado no catálogo do tenant.
export interface DecodedScaleBarcode {
  internalCode: string; // casa com `Product.barcode` cadastrado para o item pesável
  weightKg: number;
}

function isValidEan13CheckDigit(digits: string): boolean {
  // Algoritmo padrão EAN-13: soma alternada (peso 1/3) dos 12 primeiros dígitos,
  // dígito verificador = (10 - soma mod 10) mod 10.
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
