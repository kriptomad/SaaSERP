// apps/api/src/modules/fiscal/pis-cofins-monofasico.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.9 — PIS/COFINS monofásico (Leis
// 10.147/2000, 10.485/2002, 13.097/2015). Resolve, por `TaxRule.pisCofinsRegime`,
// se a venda deve (a) seguir a regra padrão do regime do tenant (embutido no
// DAS/cumulativo/não cumulativo) ou (b) ser segregada como receita monofásica de
// alíquota zero na revenda — nunca tributada duas vezes.
import { Prisma } from "@filitech/db";

interface PisCofinsRuleLike {
  pisCofinsRegime: "ISENTO_SIMPLES" | "CUMULATIVO" | "NAO_CUMULATIVO" | "MONOFASICO_CONCENTRADO" | "MONOFASICO_ALIQUOTA_ZERO";
  pisAliquotaConcentrada: Prisma.Decimal | null;
  cofinsAliquotaConcentrada: Prisma.Decimal | null;
}

export function resolvePisCofinsForSale(rule: PisCofinsRuleLike, grossAmount: Prisma.Decimal): { amount: Prisma.Decimal; segregatedAsMonofasico: boolean } {
  switch (rule.pisCofinsRegime) {
    case "MONOFASICO_ALIQUOTA_ZERO":
      // O varejista/distribuidor não recolhe nada — mas a receita PRECISA ser marcada
      // como segregada para exclusão da base do PGDAS-D (Simples) ou da apuração
      // normal (Presumido/Real), nunca silenciosamente somada ao restante do faturamento.
      return { amount: new Prisma.Decimal(0), segregatedAsMonofasico: true };
    case "MONOFASICO_CONCENTRADO":
      // Só se aplica à própria indústria/importador (ex.: uma Padaria que também
      // engarrafa e vende sua própria bebida sob marca própria) — a maioria dos
      // tenants do Filitech nunca cai neste branch.
      return {
        amount: grossAmount
          .mul((rule.pisAliquotaConcentrada ?? new Prisma.Decimal(0)).plus(rule.cofinsAliquotaConcentrada ?? new Prisma.Decimal(0)))
          .div(100),
        segregatedAsMonofasico: false,
      };
    case "CUMULATIVO": // Lucro Presumido — 0,65% PIS + 3,00% COFINS = 3,65% sobre a receita bruta, sem direito a crédito
      return { amount: grossAmount.mul(0.0365), segregatedAsMonofasico: false };
    case "NAO_CUMULATIVO": // Lucro Real — 1,65% PIS + 7,60% COFINS = 9,25%, com direito a crédito sobre insumos (crédito apurado à parte, Capítulo 17.1)
      return { amount: grossAmount.mul(0.0925), segregatedAsMonofasico: false };
    default: // ISENTO_SIMPLES — embutido no DAS, não destacado nesta venda
      return { amount: new Prisma.Decimal(0), segregatedAsMonofasico: false };
  }
}
