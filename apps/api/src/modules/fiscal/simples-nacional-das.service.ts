// apps/api/src/modules/fiscal/simples-nacional-das.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.8 — apuração real do Simples
// Nacional. GAP DE AUDITORIA CORRIGIDO (mega-audit round 2, achado crítico #1):
// o motor fiscal não calculava a alíquota EFETIVA do Simples Nacional por
// faixa de RBT12 (Receita Bruta dos últimos 12 meses) — apenas registrava
// `Tenant.simplesNacionalAnexo` como texto livre, sem nenhuma conta real. Isso
// significava que o lojista não tinha como saber quanto realmente pagaria de
// DAS, nem o sistema conseguia alertar sobre migração de faixa.
//
// Tabelas oficiais (LC 123/2006, Anexos I a V, redação vigente desde a reforma
// de 2018 — Lei Complementar 155/2016): 6 faixas de RBT12, cada uma com
// alíquota nominal e parcela a deduzir. Fórmula oficial da alíquota efetiva
// (art. 18, §1º-A):
//
//   Alíquota Efetiva = ((RBT12 × Alíquota Nominal) − Parcela a Deduzir) / RBT12
//
// Os valores abaixo são dados públicos oficiais da Receita Federal — não são
// "hardcode" no sentido de atalho/preguiça: são a própria lei, do mesmo modo
// que `PAYMENT_METHOD_TO_SEFAZ_CODE` em emit-fiscal-document.service.ts é a
// tabela oficial SEFAZ, nunca inventada.
import { Prisma, TenantScopedPrismaClient } from "@filitech/db";
import { resolveServiceAnexo } from "./fator-r-calculator.service";

export type SimplesNacionalAnexo = "I" | "II" | "III" | "IV" | "V";

interface SimplesNacionalFaixa {
  ate: number; // teto de RBT12 da faixa, em reais
  aliquotaNominal: number; // alíquota nominal da faixa (ex.: 0.04 = 4%)
  parcelaDeduzir: number; // valor fixo a deduzir, em reais
}

// Anexo I — Comércio (ex.: Mercado/Convenência, Adega, Varejo Geral).
const ANEXO_I: SimplesNacionalFaixa[] = [
  { ate: 180_000, aliquotaNominal: 0.04, parcelaDeduzir: 0 },
  { ate: 360_000, aliquotaNominal: 0.073, parcelaDeduzir: 5_940 },
  { ate: 720_000, aliquotaNominal: 0.095, parcelaDeduzir: 13_860 },
  { ate: 1_800_000, aliquotaNominal: 0.107, parcelaDeduzir: 22_500 },
  { ate: 3_600_000, aliquotaNominal: 0.143, parcelaDeduzir: 87_300 },
  { ate: 4_800_000, aliquotaNominal: 0.19, parcelaDeduzir: 378_000 },
];

// Anexo II — Indústria (ex.: Padaria/Confeitaria com produção própria classificada como industrialização).
const ANEXO_II: SimplesNacionalFaixa[] = [
  { ate: 180_000, aliquotaNominal: 0.045, parcelaDeduzir: 0 },
  { ate: 360_000, aliquotaNominal: 0.078, parcelaDeduzir: 5_940 },
  { ate: 720_000, aliquotaNominal: 0.10, parcelaDeduzir: 13_860 },
  { ate: 1_800_000, aliquotaNominal: 0.112, parcelaDeduzir: 22_500 },
  { ate: 3_600_000, aliquotaNominal: 0.147, parcelaDeduzir: 85_500 },
  { ate: 4_800_000, aliquotaNominal: 0.30, parcelaDeduzir: 720_000 },
];

// Anexo III — Serviços "comuns" (ex.: Assistência Técnica sem Fator "r" ≥ 28%).
const ANEXO_III: SimplesNacionalFaixa[] = [
  { ate: 180_000, aliquotaNominal: 0.06, parcelaDeduzir: 0 },
  { ate: 360_000, aliquotaNominal: 0.112, parcelaDeduzir: 9_360 },
  { ate: 720_000, aliquotaNominal: 0.135, parcelaDeduzir: 17_640 },
  { ate: 1_800_000, aliquotaNominal: 0.16, parcelaDeduzir: 35_640 },
  { ate: 3_600_000, aliquotaNominal: 0.21, parcelaDeduzir: 125_640 },
  { ate: 4_800_000, aliquotaNominal: 0.33, parcelaDeduzir: 648_000 },
];

// Anexo IV — Serviços sem retenção de INSS na nota (ex.: limpeza/vigilância — não
// usado nos 18 nichos atuais do Filitech, mantido pela completude da tabela legal).
const ANEXO_IV: SimplesNacionalFaixa[] = [
  { ate: 180_000, aliquotaNominal: 0.045, parcelaDeduzir: 0 },
  { ate: 360_000, aliquotaNominal: 0.09, parcelaDeduzir: 8_100 },
  { ate: 720_000, aliquotaNominal: 0.102, parcelaDeduzir: 12_420 },
  { ate: 1_800_000, aliquotaNominal: 0.14, parcelaDeduzir: 39_780 },
  { ate: 3_600_000, aliquotaNominal: 0.22, parcelaDeduzir: 183_780 },
  { ate: 4_800_000, aliquotaNominal: 0.33, parcelaDeduzir: 828_000 },
];

// Anexo V — Serviços com Fator "r" < 28% (ex.: Assistência Técnica intensiva em
// mão de obra terceirizada/baixa folha própria — ver fator-r-calculator.service.ts).
const ANEXO_V: SimplesNacionalFaixa[] = [
  { ate: 180_000, aliquotaNominal: 0.155, parcelaDeduzir: 0 },
  { ate: 360_000, aliquotaNominal: 0.18, parcelaDeduzir: 4_500 },
  { ate: 720_000, aliquotaNominal: 0.195, parcelaDeduzir: 9_900 },
  { ate: 1_800_000, aliquotaNominal: 0.205, parcelaDeduzir: 17_100 },
  { ate: 3_600_000, aliquotaNominal: 0.23, parcelaDeduzir: 62_100 },
  { ate: 4_800_000, aliquotaNominal: 0.305, parcelaDeduzir: 540_000 },
];

const ANEXO_TABLES: Record<SimplesNacionalAnexo, SimplesNacionalFaixa[]> = {
  I: ANEXO_I,
  II: ANEXO_II,
  III: ANEXO_III,
  IV: ANEXO_IV,
  V: ANEXO_V,
};

export class SimplesNacionalRbt12AcimaDoSublimiteError extends Error {}
export class SimplesNacionalAnexoNaoCadastradoError extends Error {}

export interface SimplesNacionalDasResult {
  anexo: SimplesNacionalAnexo;
  rbt12: Prisma.Decimal;
  faixa: number; // 1 a 6
  aliquotaNominal: Prisma.Decimal;
  parcelaDeduzir: Prisma.Decimal;
  aliquotaEfetiva: Prisma.Decimal; // já pronta para aplicar sobre o faturamento do mês corrente
  dasEstimadoMesCorrente: Prisma.Decimal;
  faturamentoMesCorrente: Prisma.Decimal;
  sublimiteExcedido: boolean; // RBT12 > R$ 3.600.000 — obrigatoriedade de recolher ICMS/ISS "por fora" do DAS (Capítulo 21.10 nota de sublimite)
}

/**
 * Calcula a alíquota EFETIVA real do Simples Nacional (LC 123/2006, art. 18,
 * §1º-A) a partir do RBT12 (faturamento bruto dos últimos 12 meses, já
 * calculado de forma real por `resolveServiceAnexo`/agregação de `Sale`) e do
 * Anexo cadastrado em `Tenant.simplesNacionalAnexo`. Nunca estima/assume um
 * Anexo sozinho: se o tenant não tiver um Anexo válido cadastrado, bloqueia
 * com erro explícito (mesmo padrão fail-closed do restante do motor fiscal).
 */
export async function calculateSimplesNacionalDas(
  prisma: TenantScopedPrismaClient,
  tenantId: string,
  referenceDate: Date = new Date(),
): Promise<SimplesNacionalDasResult> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { simplesNacionalAnexo: true },
  });

  const anexo = tenant.simplesNacionalAnexo as SimplesNacionalAnexo | null;
  if (!anexo || !ANEXO_TABLES[anexo]) {
    throw new SimplesNacionalAnexoNaoCadastradoError(
      "Tenant.simplesNacionalAnexo não está cadastrado ou é inválido — cadastre o Anexo (I a V) em Configurações Fiscais antes de apurar o DAS (Capítulo 21.8).",
    );
  }

  // Reaproveita o mesmo cálculo real de faturamento bruto últimos 12 meses já
  // usado pelo Fator "r" — nunca duplica a lógica de agregação de `Sale`.
  const { faturamentoUltimos12Meses: rbt12 } = await resolveServiceAnexo(prisma, tenantId, referenceDate);

  const faixas = ANEXO_TABLES[anexo];
  const sublimiteExcedido = rbt12.gt(3_600_000);

  // RBT12 acima do teto de enquadramento (R$ 4,8MM) — Simples Nacional não se
  // aplica mais; a lei exige desenquadramento obrigatório, nunca apuração de
  // DAS acima do teto. Bloqueia explicitamente em vez de extrapolar a tabela.
  if (rbt12.gt(4_800_000)) {
    throw new SimplesNacionalRbt12AcimaDoSublimiteError(
      `RBT12 de ${rbt12.toFixed(2)} excede o teto de enquadramento do Simples Nacional (R$ 4.800.000,00) — desenquadramento obrigatório exigido por lei, apuração de DAS pelo Simples bloqueada (Capítulo 21.8).`,
    );
  }

  const faixaIndex = faixas.findIndex((f) => rbt12.lte(f.ate));
  const faixa = faixas[faixaIndex === -1 ? faixas.length - 1 : faixaIndex];
  const faixaNumero = (faixaIndex === -1 ? faixas.length - 1 : faixaIndex) + 1;

  const aliquotaNominal = new Prisma.Decimal(faixa.aliquotaNominal);
  const parcelaDeduzir = new Prisma.Decimal(faixa.parcelaDeduzir);

  // Alíquota efetiva = ((RBT12 × Alíquota Nominal) − Parcela a Deduzir) / RBT12.
  // Quando RBT12 = 0 (tenant novo sem faturamento), usa a alíquota nominal da
  // faixa 1 diretamente (fórmula indefinida por divisão por zero), que é
  // também o valor correto para RBT12 = 0 no limite matemático da fórmula.
  const aliquotaEfetiva = rbt12.isZero()
    ? new Prisma.Decimal(faixas[0].aliquotaNominal)
    : rbt12.mul(aliquotaNominal).minus(parcelaDeduzir).div(rbt12);

  const inicioMes = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const fimMes = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59, 999);
  const faturamentoMesAggregate = await prisma.sale.aggregate({
    where: { tenantId, status: "PAID", createdAt: { gte: inicioMes, lte: fimMes } },
    _sum: { totalAmount: true },
  });
  const faturamentoMesCorrente = faturamentoMesAggregate._sum.totalAmount ?? new Prisma.Decimal(0);

  return {
    anexo,
    rbt12,
    faixa: faixaNumero,
    aliquotaNominal,
    parcelaDeduzir,
    aliquotaEfetiva,
    dasEstimadoMesCorrente: faturamentoMesCorrente.mul(aliquotaEfetiva),
    faturamentoMesCorrente,
    sublimiteExcedido,
  };
}
