// apps/api/src/modules/fiscal/used-vehicle-icms.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.12 — regime especial de base de
// cálculo reduzida do ICMS na revenda de veículos usados (Convênios ICM 15/81 e
// ICMS 33/93). Evita o erro grave e comum do nicho Loja de Veículos Seminovos de
// tributar o ICMS sobre o valor cheio da venda — o veículo já foi tributado
// integralmente quando novo.
import { Prisma } from "@filitech/db";

interface UsedVehicleTaxEngineClient {
  taxRule: {
    findFirst(args: any): Promise<{ icmsBaseReductionPercent: Prisma.Decimal | null; icmsAliquota: Prisma.Decimal | null } | null>;
  };
}

export class UsedVehicleTaxRuleMissingError extends Error {}

export async function calculateUsedVehicleIcms(
  prisma: UsedVehicleTaxEngineClient,
  input: { tenantId: string; uf: string; saleAmount: Prisma.Decimal },
): Promise<Prisma.Decimal> {
  const rule = await prisma.taxRule.findFirst({
    where: {
      AND: [
        { OR: [{ tenantId: input.tenantId }, { tenantId: null }] },
        { uf: input.uf },
        { nicheCode: "USED_CAR_DEALERSHIP" },
        { effectiveFrom: { lte: new Date() } },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      ],
    },
    orderBy: { effectiveFrom: "desc" },
  });

  if (!rule || !rule.icmsBaseReductionPercent) {
    throw new UsedVehicleTaxRuleMissingError(
      `UF ${input.uf} sem regra de redução de base cadastrada para veículos usados (nicheCode USED_CAR_DEALERSHIP) — venda bloqueada até cadastro (nunca assume um percentual padrão para um tributo tão sensível a erro).`,
    );
  }

  // Base reduzida — ex.: SP usa 10% do valor da operação (redução de 90%), MG usa 5%
  // (redução de 95%) — o percentual real sempre vem da TaxRule específica da UF,
  // nunca hardcoded no código, por ser uma das regras que mais varia entre estados.
  const reducedBase = input.saleAmount.mul(rule.icmsBaseReductionPercent).div(100);
  return reducedBase.mul(rule.icmsAliquota ?? new Prisma.Decimal(18)).div(100);
}
