// apps/api/src/modules/fiscal/tax-engine.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.6 — Motor de Cálculo Central. Único ponto
// do sistema que decide "quanto e qual imposto incide"; nenhuma outra rota de
// venda/O.S./produção calcula tributo por conta própria. `calculateTax` é a versão
// simplificada (Capítulo 21.6, mantida intacta para os chamadores que não precisam
// de aprofundamento fiscal: comanda.routes.ts e ifood-webhook.routes.ts).
// `calculateFullTax` (Capítulo 21.14) é a versão completa consumida por closeSale
// (Capítulo 6.6): soma DIFAL (21.10), PIS/COFINS monofásico (21.9), ICMS de veículo
// usado (21.12) e resolução dinâmica de CFOP (21.13) por cima do núcleo de 21.6.
import { Prisma } from "@filitech/db";
import { resolvePisCofinsForSale } from "./pis-cofins-monofasico.service";
import { calculateDifal } from "./difal-calculator.service";
import { calculateUsedVehicleIcms, UsedVehicleTaxRuleMissingError } from "./used-vehicle-icms.service";
import { resolveCfop } from "./cfop-resolver.service";

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

interface TaxRuleLike {
  id: string;
  legalReference: string;
  icmsStMva: Prisma.Decimal | null;
  icmsAliquota: Prisma.Decimal | null;
  ibsAliquota: Prisma.Decimal | null;
  cbsAliquota: Prisma.Decimal | null;
  selectiveTaxAliquota: Prisma.Decimal | null;
  // Campos adicionais consumidos apenas por `calculateFullTax` (Capítulo 21.14) —
  // `calculateTax` (21.6) nunca os lê, mas precisam ser selecionados pelo chamador
  // para que o mesmo `findFirst` sirva às duas funções sem duplicar a query.
  pisCofinsRegime?: "ISENTO_SIMPLES" | "CUMULATIVO" | "NAO_CUMULATIVO" | "MONOFASICO_CONCENTRADO" | "MONOFASICO_ALIQUOTA_ZERO";
  pisAliquotaConcentrada?: Prisma.Decimal | null;
  cofinsAliquotaConcentrada?: Prisma.Decimal | null;
  cstCsosn?: string | null;
  icmsBaseReductionPercent: Prisma.Decimal | null;
  icmsInterestadualAliquota: Prisma.Decimal | null;
}

// Interface estrutural deliberadamente desacoplada dos tipos genéricos gerados pela
// Prisma Client Extension: `calculateTax` é chamado tanto dentro de transações do
// cliente tenant-scoped (closeSale, comanda, consumeRecipeForComandaItem) quanto
// dentro de uma transação do cliente bruto `prismaUnscoped` (webhook do iFood, que
// roda fora de qualquer contexto de tenant autenticado — não existe AsyncLocalStorage
// de tenant disponível num webhook de marketplace). Os tipos gerados pela extensão
// (`DynamicModelExtensionFluentApi` etc.) e pelo client bruto não são estruturalmente
// unificáveis em uma união sem estourar a profundidade de comparação de tipos do
// TypeScript — por isso usamos aqui apenas o subconjunto mínimo de shape realmente
// consumido pela função, que ambos os clientes satisfazem.
interface TaxEngineClient {
  tenant: {
    findUniqueOrThrow(args: {
      where: { id: string };
      select: { taxRegime: true; simplesNacionalAnexo: true };
    }): Promise<{ taxRegime: string; simplesNacionalAnexo: string | null }>;
  };
  taxRule: {
    findFirst(args: any): Promise<TaxRuleLike | null>;
  };
}

export async function calculateTax(
  prisma: TaxEngineClient,
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

export interface FullTaxCalculationInput extends TaxCalculationInput {
  originUf: string; // UF do estabelecimento do tenant (emitente) — necessária para resolver interestadualidade real (Capítulo 21.10/21.13)
  destinationUf: string; // UF do cliente (Client.uf); cai para `uf` (UF do tenant) quando o cliente não tem UF cadastrada — venda presencial local
  buyerIsIcmsContributor: boolean; // Client.icmsContributor — decide se o DIFAL (consumidor final) se aplica
  isServiceItem: boolean; // true para item de O.S. (mão de obra) — fora do escopo de DIFAL/CFOP de mercadoria
  isOwnProduction?: boolean; // true quando o item é de produção própria (Capítulo 21.13) — ex.: Padaria vendendo pão de produção própria
  isReturn?: boolean; // true em devolução de venda/compra (Capítulo 21.13)
}

export interface FullTaxCalculationResult extends TaxCalculationResult {
  difalAmount: Prisma.Decimal;
  monofasicoSegregatedAmount: Prisma.Decimal; // receita que deve ser excluída da base do DAS/apuração por já ter PIS/COFINS recolhido na origem (Capítulo 21.9)
  usedVehicleIcmsAmount: Prisma.Decimal;
  cfop: string;
}

// Superset de `TaxEngineClient` com os modelos adicionais consumidos apenas pelas
// camadas de aprofundamento (DIFAL/veículo usado) de `calculateFullTax`.
interface FullTaxEngineClient extends TaxEngineClient {
  taxRule: {
    findFirst(args: any): Promise<TaxRuleLike | null>;
  };
}

export async function calculateFullTax(
  prisma: FullTaxEngineClient,
  input: FullTaxCalculationInput,
): Promise<FullTaxCalculationResult> {
  // Reaproveita o núcleo de 21.6 (ICMS-ST, IBS/CBS, Imposto Seletivo) — nunca
  // duplica a lógica base, apenas acrescenta as camadas 21.9/21.10/21.12/21.13.
  const base = await calculateTax(prisma, input);

  const isInterstate = input.originUf !== input.destinationUf;

  // Item de serviço (O.S.) não passa por DIFAL/CFOP de mercadoria nem por regra de
  // veículo usado — essas três camadas são exclusivas de item de PRODUTO.
  if (input.isServiceItem) {
    return {
      ...base,
      difalAmount: new Prisma.Decimal(0),
      monofasicoSegregatedAmount: new Prisma.Decimal(0),
      usedVehicleIcmsAmount: new Prisma.Decimal(0),
      cfop: "",
    };
  }

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

  const pisCofins = rule
    ? resolvePisCofinsForSale(
        {
          pisCofinsRegime: rule.pisCofinsRegime ?? "ISENTO_SIMPLES",
          pisAliquotaConcentrada: rule.pisAliquotaConcentrada ?? null,
          cofinsAliquotaConcentrada: rule.cofinsAliquotaConcentrada ?? null,
        },
        input.grossAmount,
      )
    : { amount: new Prisma.Decimal(0), segregatedAsMonofasico: false };

  const { difalDestino } = await calculateDifal(prisma, {
    tenantId: input.tenantId,
    originUf: input.originUf,
    destinationUf: input.destinationUf,
    ncm: input.ncm,
    grossAmount: input.grossAmount,
    buyerIsIcmsContributor: input.buyerIsIcmsContributor,
  });

  // Veículo usado (Capítulo 21.12) exige TaxRule específica por UF — ausência de
  // regra bloqueia a venda (ver `UsedVehicleTaxRuleMissingError`), nunca assume
  // alíquota cheia silenciosamente, que seria tributação indevida em dobro.
  let usedVehicleIcmsAmount = new Prisma.Decimal(0);
  if (input.nicheCode === "USED_CAR_DEALERSHIP") {
    try {
      usedVehicleIcmsAmount = await calculateUsedVehicleIcms(prisma, {
        tenantId: input.tenantId,
        uf: input.uf,
        saleAmount: input.grossAmount,
      });
    } catch (error) {
      if (error instanceof UsedVehicleTaxRuleMissingError) throw error;
      throw error;
    }
  }

  const cfop = resolveCfop({
    isInterstate,
    isSubjectToIcmsSt: Boolean(rule?.icmsStMva),
    isOwnProduction: Boolean(input.isOwnProduction),
    isReturn: Boolean(input.isReturn),
  });

  return {
    ...base,
    // PIS/COFINS monofásico substitui (nunca soma) o cálculo padrão de 21.6 quando
    // a regra for monofásica — a receita monofásica já foi tributada na origem.
    legacyPisCofinsAmount: pisCofins.segregatedAsMonofasico ? new Prisma.Decimal(0) : pisCofins.amount.gt(0) ? pisCofins.amount : base.legacyPisCofinsAmount,
    difalAmount: difalDestino,
    monofasicoSegregatedAmount: pisCofins.segregatedAsMonofasico ? input.grossAmount : new Prisma.Decimal(0),
    usedVehicleIcmsAmount,
    cfop,
  };
}
