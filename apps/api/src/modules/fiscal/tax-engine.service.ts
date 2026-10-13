// apps/api/src/modules/fiscal/tax-engine.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.6 — Motor de Cálculo Central. Único ponto
// do sistema que decide "quanto e qual imposto incide"; nenhuma outra rota de
// venda/O.S./produção calcula tributo por conta própria. Esta é a versão consumida
// por closeSale (Capítulo 6.6). A versão `calculateFullTax` (Capítulo 21.14, que
// adiciona DIFAL/PIS-COFINS monofásico/ISS/veículo usado) é uma camada posterior de
// aprofundamento fiscal — ainda não portada para código nesta fase da implementação.
import { Prisma, PrismaClient } from "@filitech/db";

export interface TaxCalculationInput {
  tenantId: string;
  ncm: string;
  uf: string;
  nicheCode: string;
  grossAmount: Prisma.Decimal;
}

export interface TaxCalculationResult {
  legacyIcmsAmount: Prisma.Decimal;
  legacyPisCofinsAmount: Prisma.Decimal;
  ibsAmount: Prisma.Decimal;
  cbsAmount: Prisma.Decimal;
  selectiveTaxAmount: Prisma.Decimal;
  appliedRules: { ruleId: string; legalReference: string }[];
}

export async function calculateTax(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: TaxCalculationInput,
): Promise<TaxCalculationResult> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: input.tenantId },
    select: { taxRegime: true, simplesNacionalAnexo: true },
  });

  // Resolve a regra mais específica primeiro (NCM+UF+nicho) e cai para regras mais
  // genéricas apenas na ausência de uma regra específica — nunca o inverso, para que
  // uma exceção estadual específica sempre vença uma regra nacional genérica.
  const rule = await prisma.taxRule.findFirst({
    where: {
      OR: [{ tenantId: input.tenantId }, { tenantId: null }],
      AND: [
        { OR: [{ ncm: input.ncm }, { ncm: null }] },
        { OR: [{ uf: input.uf }, { uf: null }] },
        { OR: [{ nicheCode: input.nicheCode }, { nicheCode: null }] },
        { effectiveFrom: { lte: new Date() } },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      ],
    },
    orderBy: [{ ncm: "desc" }, { uf: "desc" }, { nicheCode: "desc" }],
  });

  if (!rule) {
    throw new Error(
      `Nenhuma TaxRule aplicável para NCM ${input.ncm} / UF ${input.uf} / nicho ${input.nicheCode} — venda bloqueada até cadastro da regra.`,
    );
  }

  // Simples Nacional: ICMS "normal" já embutido no DAS (não destacado) — apenas o
  // ICMS-ST (se a regra tiver MVA) é calculado à parte, nunca duplicado.
  const legacyIcmsAmount = rule.icmsStMva
    ? input.grossAmount.mul(rule.icmsStMva.div(100)).mul(rule.icmsAliquota?.div(100) ?? new Prisma.Decimal(0))
    : new Prisma.Decimal(0);

  return {
    legacyIcmsAmount,
    legacyPisCofinsAmount:
      tenant.taxRegime === "LUCRO_REAL" ? input.grossAmount.mul(0.0365) : new Prisma.Decimal(0),
    ibsAmount: input.grossAmount.mul((rule.ibsAliquota ?? new Prisma.Decimal(0)).div(100)),
    cbsAmount: input.grossAmount.mul((rule.cbsAliquota ?? new Prisma.Decimal(0)).div(100)),
    selectiveTaxAmount: input.grossAmount.mul((rule.selectiveTaxAliquota ?? new Prisma.Decimal(0)).div(100)),
    appliedRules: [{ ruleId: rule.id, legalReference: rule.legalReference }],
  };
}
