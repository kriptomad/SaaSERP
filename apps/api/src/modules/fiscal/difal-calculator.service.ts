// apps/api/src/modules/fiscal/difal-calculator.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.10 — DIFAL (Diferencial de Alíquota
// do ICMS em vendas interestaduais a consumidor final não contribuinte, EC 87/2015,
// LC 190/2022). Relevante sempre que um tenant vende para fora do seu estado via
// canal online/WhatsApp (Capítulo 8/20.2) a uma pessoa física em outro estado.
import { Prisma } from "@filitech/db";

// CORREÇÃO (mega-audit round 2, achado crítico #4): antes desta correção, a
// ausência de `TaxRule` para a UF de origem/destino era silenciosamente coberta
// por um "padrão conservador" de 12%/18% — o que podia subestimar ou superestimar
// o DIFAL real de qualquer UF específica sem que ninguém percebesse (nenhuma venda
// era bloqueada, nenhum alerta era emitido). Alinhado ao mesmo padrão "fail-closed"
// já usado por `UsedVehicleTaxRuleMissingError` (used-vehicle-icms.service.ts) e
// pela própria `calculateTax` (TaxRule ausente bloqueia a venda) — agora a ausência
// de uma `TaxRule` de ICMS para a UF envolvida bloqueia a venda interestadual até
// cadastro explícito da alíquota real daquela UF, nunca um chute silencioso.
export class DifalTaxRuleMissingError extends Error {}

interface DifalTaxEngineClient {
  tenant: {
    findUniqueOrThrow(args: { where: { id: string }; select: { taxRegime: true } }): Promise<{ taxRegime: string }>;
  };
  taxRule: {
    findFirst(args: any): Promise<{ icmsInterestadualAliquota: Prisma.Decimal | null; icmsAliquota: Prisma.Decimal | null } | null>;
  };
}

export async function calculateDifal(
  prisma: DifalTaxEngineClient,
  input: { tenantId: string; originUf: string; destinationUf: string; ncm: string; grossAmount: Prisma.Decimal; buyerIsIcmsContributor: boolean },
): Promise<{ icmsOrigem: Prisma.Decimal; difalDestino: Prisma.Decimal }> {
  // Regra básica: DIFAL só se aplica a venda interestadual para CONSUMIDOR FINAL NÃO
  // CONTRIBUINTE — vendas B2B para outro contribuinte de ICMS seguem a regra normal
  // de CFOP interestadual (6.xxx), sem partilha de DIFAL.
  if (input.originUf === input.destinationUf || input.buyerIsIcmsContributor) {
    return { icmsOrigem: new Prisma.Decimal(0), difalDestino: new Prisma.Decimal(0) };
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { taxRegime: true } });
  if (tenant.taxRegime === "SIMPLES_NACIONAL") {
    // Dispensa de DIFAL para o Simples Nacional, nos termos da ADI 5464/STF — a
    // dispensa segue vigente mesmo com a LC 190/2022, até decisão legislativa em
    // contrário; o `TaxRule` de cada UF pode sobrescrever este comportamento via uma
    // regra específica caso uma UF decida (incomum) exigir de qualquer forma.
    return { icmsOrigem: new Prisma.Decimal(0), difalDestino: new Prisma.Decimal(0) };
  }

  const originRule = await prisma.taxRule.findFirst({
    where: {
      AND: [
        { OR: [{ tenantId: input.tenantId }, { tenantId: null }] },
        { uf: input.originUf },
        { OR: [{ ncm: input.ncm }, { ncm: null }] },
        { effectiveFrom: { lte: new Date() } },
      ],
    },
    orderBy: [{ ncm: "desc" }, { effectiveFrom: "desc" }],
  });
  const destinationRule = await prisma.taxRule.findFirst({
    where: {
      AND: [
        { OR: [{ tenantId: input.tenantId }, { tenantId: null }] },
        { uf: input.destinationUf },
        { OR: [{ ncm: input.ncm }, { ncm: null }] },
        { effectiveFrom: { lte: new Date() } },
      ],
    },
    orderBy: [{ ncm: "desc" }, { effectiveFrom: "desc" }],
  });

  if (!originRule?.icmsInterestadualAliquota) {
    throw new DifalTaxRuleMissingError(
      `Nenhuma TaxRule com alíquota interestadual de ICMS cadastrada para a UF de origem ${input.originUf} — venda interestadual para consumidor final bloqueada até cadastro da regra (Capítulo 21.10).`,
    );
  }
  if (!destinationRule?.icmsAliquota) {
    throw new DifalTaxRuleMissingError(
      `Nenhuma TaxRule com alíquota interna de ICMS cadastrada para a UF de destino ${input.destinationUf} — venda interestadual para consumidor final bloqueada até cadastro da regra (Capítulo 21.10).`,
    );
  }

  const interstateAliquota = originRule.icmsInterestadualAliquota;
  const destinationInternalAliquota = destinationRule.icmsAliquota;

  const icmsOrigem = input.grossAmount.mul(interstateAliquota).div(100);
  const difalDestino = input.grossAmount.mul(destinationInternalAliquota.minus(interstateAliquota)).div(100);

  return { icmsOrigem, difalDestino };
}
