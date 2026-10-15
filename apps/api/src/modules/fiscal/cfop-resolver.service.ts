// apps/api/src/modules/fiscal/cfop-resolver.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.13 — resolve o CFOP correto por tipo
// de operação. Nunca um valor fixo "5102 para tudo" (erro real e frequente de ERPs
// pequenos que gera autuação por CFOP incompatível com a natureza real da operação
// registrada no XML).
export function resolveCfop(input: { isInterstate: boolean; isSubjectToIcmsSt: boolean; isOwnProduction: boolean; isReturn: boolean }): string {
  if (input.isReturn) return input.isInterstate ? "2202" : "1202";
  if (input.isSubjectToIcmsSt) return input.isInterstate ? "6405" : "5405";
  if (input.isOwnProduction) return input.isInterstate ? "6101" : "5101";
  return input.isInterstate ? "6102" : "5102";
}
