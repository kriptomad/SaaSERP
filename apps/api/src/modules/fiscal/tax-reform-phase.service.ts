// apps/api/src/modules/fiscal/tax-reform-phase.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.15 — calendário legal automático da
// Reforma Tributária (LC 214/2025). NÃO é um toggle manual: a fase é 100% resolvida
// pela data da venda, nunca por uma escolha do lojista. O único mecanismo de escolha
// real que existe é o "Simples Híbrido" (resolveIbsCbsRegimeForTenant, abaixo),
// mecanismo inteiramente distinto que este arquivo nunca confunde com a fase.
import type { FaseReformaTributaria } from "@filitech/db";

/**
 * Resolve a fase da Reforma Tributária vigente em uma data — usada exclusivamente
 * no momento da emissão do FiscalDocument (nunca recalculada depois, mesmo que a
 * legislação mude: o documento já emitido reflete a fase real do dia da venda).
 */
export function resolveTaxReformPhase(saleDate: Date): FaseReformaTributaria {
  const year = saleDate.getFullYear();
  if (year <= 2026) return "TESTE_COMPENSAVEL";
  if (year <= 2032) return "TRANSICAO_PLENA";
  return "REGIME_PLENO";
}
