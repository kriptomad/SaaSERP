// apps/api/src/modules/fiscal/difal-calculator.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.10 — DIFAL (Diferencial de Alíquota
// do ICMS em vendas interestaduais a consumidor final não contribuinte, EC 87/2015,
// LC 190/2022). Relevante sempre que um tenant vende para fora do seu estado via
// canal online/WhatsApp (Capítulo 8/20.2) a uma pessoa física em outro estado.
import { Prisma } from "@filitech/db";

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

  const interstateAliquota = originRule?.icmsInterestadualAliquota ?? new Prisma.Decimal(12); // 12% como padrão conservador na ausência de regra específica (a maioria das rotas não-Sul/Sudeste)
  const destinationInternalAliquota = destinationRule?.icmsAliquota ?? new Prisma.Decimal(18); // 18% é a alíquota interna mais comum entre as UFs na ausência de regra cadastrada

  const icmsOrigem = input.grossAmount.mul(interstateAliquota).div(100);
  const difalDestino = input.grossAmount.mul(destinationInternalAliquota.minus(interstateAliquota)).div(100);

  return { icmsOrigem, difalDestino };
}
