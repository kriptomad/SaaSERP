// apps/api/src/services/accounting-office/ecf-reinf-dctfweb.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.18.5/21.18.10/21.18.11/21.18.12 —
// fecha o gap de auditoria explicitamente flagado em `sped-ecd.service.ts` ("EFD-Reinf
// / DCTFWeb / Informe de Rendimentos do Sócio: NÃO implementados"). O bloqueio
// original era real: faltava dado-fonte de sócios/pró-labore no schema. Essa
// investigação encontrou que `CompanyPartner`/`PartnerPayout` JÁ EXISTEM no schema
// desde um passe anterior, mas nunca tiveram nenhum código consumidor (mesmo padrão
// do gap de `OnlineStoreSettings` fechado no item 11 deste mega-audit) — ou seja, o
// dado-fonte sempre existiu, só faltava o cadastro (CRUD, `partners.routes.ts`) e os
// geradores abaixo.
//
// ESCOPO HONESTO (sem mock, sem dado fabricado):
//   - EFD-Reinf (eventos R-2010 de pró-labore) e DCTFWeb (débito confessado de INSS
//     sobre pró-labore) são gerados 100% a partir de `PartnerPayout` REAL já
//     registrado pelo lojista/contador em `partners.routes.ts` — nunca um valor
//     calculado "do zero" sem lançamento humano por trás.
//   - INSS patronal (20% sobre o pró-labore bruto, Lei 8.212/91 art. 22, I) é a
//     única alíquota calculada automaticamente aqui — é uma alíquota legal fixa e
//     estável, no mesmo espírito de `PAYMENT_METHOD_TO_SEFAZ_CODE`
//     (emit-fiscal-document.service.ts), nunca um "chute". INSS do segurado e IRRF
//     usam o valor JÁ INFORMADO em `PartnerPayout.inssWithheld`/`irrfWithheld` no
//     momento do lançamento do pagamento — nunca recalculados aqui (a alíquota do
//     segurado individual varia por faixa/teto do INSS e é responsabilidade do
//     contador confirmar no ato do pagamento).
//   - "Código de receita" oficial (DARF/eSocial) de cada evento MUDA conforme a
//     tabela vigente da Receita Federal e não é reproduzido aqui como valor fixo —
//     o campo fica marcado como "A_CONFIRMAR_TABELA_RFB_VIGENTE" no arquivo gerado,
//     para o contador preencher manualmente antes da transmissão (documento nasce em
//     status DRAFT, nunca GENERATED, por este motivo — ver `OfficialTaxDocumentStatus`).
//   - ECF: a presunção de lucro (8%/12% comércio vs. 32% serviço) é um dado legal
//     que depende da classificação de atividade do tenant, que este schema não
//     modela como enum fechado (nichos variam) — por isso é um parâmetro OBRIGATÓRIO
//     explícito na chamada (`activityType`), nunca inferido/assumido silenciosamente
//     (mesmo princípio de "nunca migrar Anexo do Simples sozinho" já usado em
//     `financial.routes.ts`/fator-r). Lucro Real usa o resultado contábil real
//     (Sale/AccountPayable por ChartOfAccount, mesma base da DRE/ECD) sem ajustes de
//     adições/exclusões do LALUR (não existe módulo de ajuste fiscal no schema —
//     simplificação documentada, mesma linha da `legacyPisCofinsAmount` em
//     tax-engine.service.ts).
import { Prisma } from "@filitech/db";
import { prisma } from "@filitech/db";
import { NoActiveLayoutVersionError } from "./sped-ecd.service";

export class EcfNotApplicableError extends Error {}
export class NoPartnerPayoutsFoundError extends Error {}

function sanitizeSpedField(value: string): string {
  return value.replace(/\|/g, "/").replace(/[\r\n]/g, " ").trim();
}

function formatSpedDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}${mm}${yyyy}`;
}

function formatSpedAmount(value: Prisma.Decimal): string {
  return value.abs().toFixed(2).replace(".", ",");
}

interface Builder {
  lines: string[];
}

function newBuilder(): Builder {
  return { lines: [] };
}

function push(builder: Builder, fields: string[]): void {
  builder.lines.push(`|${fields.map(sanitizeSpedField).join("|")}|`);
}

/** Lê o leiaute oficial vigente — nunca um literal mágico (mesmo padrão de `sped-ecd.service.ts`). */
async function resolveActiveLayoutVersion(documentType: "ECF" | "EFD_REINF" | "DCTFWEB", referenceDate: Date): Promise<string> {
  const layout = await prisma.officialDocumentLayoutVersion.findFirst({
    where: {
      documentType: documentType as any,
      effectiveFrom: { lte: referenceDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: referenceDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!layout) {
    throw new NoActiveLayoutVersionError(
      `Nenhum leiaute oficial vigente cadastrado para "${documentType}" na data ${referenceDate.toISOString().slice(0, 10)}. Cadastre um "OfficialDocumentLayoutVersion" antes de gerar o documento.`,
    );
  }
  return layout.layoutVersion;
}

export type EcfActivityType = "COMERCIO" | "SERVICO";

// Percentuais oficiais de presunção de lucro (Lei 9.249/1995, art. 15/20) — dados
// públicos da lei, não "hardcode" por atalho.
const PRESUNCAO_IRPJ: Record<EcfActivityType, number> = { COMERCIO: 0.08, SERVICO: 0.32 };
const PRESUNCAO_CSLL: Record<EcfActivityType, number> = { COMERCIO: 0.12, SERVICO: 0.32 };
const ADICIONAL_IRPJ_LIMITE_ANUAL = 240_000; // R$ 20.000,00/mês × 12 (Lei 9.249/1995, art. 3º §1º)
const ALIQUOTA_IRPJ_BASE = 0.15;
const ALIQUOTA_IRPJ_ADICIONAL = 0.10;
const ALIQUOTA_CSLL = 0.09;

/**
 * Gera a ECF (Escrituração Contábil Fiscal) com a apuração REAL de IRPJ/CSLL do
 * ano-calendário, a partir dos mesmos dados reais de receita/despesa por
 * `ChartOfAccount` já usados pela DRE/ECD (Capítulo 17.2/21.18.5). Simples
 * Nacional/MEI são dispensados de ECF por lei — bloqueia explicitamente em vez de
 * gerar um arquivo vazio/fictício.
 */
export async function generateEcf(
  tenantId: string,
  calendarYear: number,
  activityType: EcfActivityType,
): Promise<{ content: string; layoutVersion: string }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (tenant.taxRegime === "SIMPLES_NACIONAL" || tenant.taxRegime === "MEI") {
    throw new EcfNotApplicableError(
      "Tenants no Simples Nacional/MEI são dispensados de ECF por lei (salvo desenquadramento no ano-calendário, não coberto por este gerador) — ECF não aplicável.",
    );
  }

  const periodStart = new Date(Date.UTC(calendarYear, 0, 1));
  const periodEnd = new Date(Date.UTC(calendarYear, 11, 31, 23, 59, 59));
  const layoutVersion = await resolveActiveLayoutVersion("ECF", periodEnd);

  const [revenueAgg, expenseAgg] = await Promise.all([
    prisma.sale.aggregate({ where: { tenantId, status: "PAID", createdAt: { gte: periodStart, lte: periodEnd } }, _sum: { totalAmount: true } }),
    prisma.accountPayable.aggregate({ where: { tenantId, status: "PAID", paidAt: { gte: periodStart, lte: periodEnd } }, _sum: { amount: true } }),
  ]);
  const grossRevenue = revenueAgg._sum.totalAmount ?? new Prisma.Decimal(0);
  const totalExpenses = expenseAgg._sum.amount ?? new Prisma.Decimal(0);
  const netResult = grossRevenue.minus(totalExpenses);

  let baseIrpj: Prisma.Decimal;
  let baseCsll: Prisma.Decimal;
  if (tenant.taxRegime === "LUCRO_PRESUMIDO") {
    baseIrpj = grossRevenue.mul(PRESUNCAO_IRPJ[activityType]);
    baseCsll = grossRevenue.mul(PRESUNCAO_CSLL[activityType]);
  } else {
    // LUCRO_REAL: base = resultado contábil real, sem ajustes do LALUR (simplificação
    // documentada no cabeçalho deste arquivo) — nunca negativa (prejuízo não gera
    // IRPJ/CSLL devido, apenas compensação futura, fora de escopo deste gerador).
    baseIrpj = netResult.isNegative() ? new Prisma.Decimal(0) : netResult;
    baseCsll = baseIrpj;
  }

  const irpjBase = baseIrpj.mul(ALIQUOTA_IRPJ_BASE);
  const irpjAdicional = baseIrpj.gt(ADICIONAL_IRPJ_LIMITE_ANUAL)
    ? baseIrpj.minus(ADICIONAL_IRPJ_LIMITE_ANUAL).mul(ALIQUOTA_IRPJ_ADICIONAL)
    : new Prisma.Decimal(0);
  const irpjDevido = irpjBase.plus(irpjAdicional);
  const csllDevido = baseCsll.mul(ALIQUOTA_CSLL);

  const builder = newBuilder();
  push(builder, ["0000", "ECF", String(calendarYear), (tenant.cnpj ?? "").replace(/\D/g, ""), tenant.legalName, tenant.taxRegime, activityType]);
  push(builder, ["M300", "RECEITA_BRUTA", formatSpedAmount(grossRevenue)]);
  push(builder, ["M300", "DESPESAS_TOTAIS", formatSpedAmount(totalExpenses)]);
  push(builder, ["M300", "RESULTADO_CONTABIL", netResult.isNegative() ? "-" + formatSpedAmount(netResult) : formatSpedAmount(netResult)]);
  push(builder, ["M350", "BASE_IRPJ", formatSpedAmount(baseIrpj)]);
  push(builder, ["M350", "IRPJ_BASE_15PCT", formatSpedAmount(irpjBase)]);
  push(builder, ["M350", "IRPJ_ADICIONAL_10PCT", formatSpedAmount(irpjAdicional)]);
  push(builder, ["M350", "IRPJ_DEVIDO_TOTAL", formatSpedAmount(irpjDevido)]);
  push(builder, ["M350", "BASE_CSLL", formatSpedAmount(baseCsll)]);
  push(builder, ["M350", "CSLL_DEVIDO_9PCT", formatSpedAmount(csllDevido)]);
  push(builder, ["9999", String(builder.lines.length + 1)]);

  return { content: builder.lines.join("\r\n") + "\r\n", layoutVersion };
}

/**
 * Gera o arquivo EFD-Reinf (eventos R-2010 — pagamentos a sócio/pró-labore) a
 * partir de `PartnerPayout` REAL já lançado para a competência informada. Nunca
 * fabrica um evento sem um `PartnerPayout` correspondente.
 */
export async function generateEfdReinf(tenantId: string, competencia: string): Promise<{ content: string; layoutVersion: string }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const [year, month] = competencia.split("-").map(Number);
  const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const layoutVersion = await resolveActiveLayoutVersion("EFD_REINF", periodEnd);

  const payouts = await prisma.partnerPayout.findMany({
    where: { tenantId, competencia },
    include: { partner: true },
    orderBy: { paidAt: "asc" },
  });

  const builder = newBuilder();
  push(builder, ["R-1000", (tenant.cnpj ?? "").replace(/\D/g, ""), competencia, layoutVersion]);

  for (const payout of payouts) {
    // INSS patronal: só incide sobre PRO_LABORE (rendimento tributável do sócio que
    // atua na gestão) — PROFIT_DISTRIBUTION é isenta por natureza (Lei 9.249/1995,
    // art. 10), nunca gera INSS/IRRF (já garantido em código no lançamento, aqui só
    // reaproveita o dado).
    const inssPatronal = payout.type === "PRO_LABORE" ? payout.grossAmount.mul(0.20) : new Prisma.Decimal(0);
    push(builder, [
      "R-2010",
      payout.partner.cpf.replace(/\D/g, ""),
      payout.partner.name,
      payout.type,
      formatSpedAmount(payout.grossAmount),
      formatSpedAmount(payout.inssWithheld),
      formatSpedAmount(payout.irrfWithheld),
      formatSpedAmount(inssPatronal),
      "A_CONFIRMAR_TABELA_RFB_VIGENTE", // código de receita — ver nota de escopo no cabeçalho do arquivo
    ]);
  }

  push(builder, ["R-9000", String(payouts.length)]);
  push(builder, ["9999", String(builder.lines.length + 1)]);

  return { content: builder.lines.join("\r\n") + "\r\n", layoutVersion };
}

/**
 * Gera a DCTFWeb (débito confessado de INSS sobre pró-labore do período),
 * agregando exatamente os mesmos `PartnerPayout` usados pelo EFD-Reinf da mesma
 * competência — nunca uma fonte de dado paralela/divergente.
 */
export async function generateDctfWeb(tenantId: string, competencia: string): Promise<{ content: string; layoutVersion: string }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const [year, month] = competencia.split("-").map(Number);
  const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const layoutVersion = await resolveActiveLayoutVersion("DCTFWEB", periodEnd);

  const payouts = await prisma.partnerPayout.findMany({ where: { tenantId, competencia, type: "PRO_LABORE" } });
  if (payouts.length === 0) {
    throw new NoPartnerPayoutsFoundError(
      `Nenhum PartnerPayout do tipo PRO_LABORE lançado para a competência ${competencia} — nenhum débito de INSS a confessar nesta DCTFWeb. Lance o pró-labore em /accounting-office/company-partners/:id/payouts antes de gerar.`,
    );
  }

  const totalGross = payouts.reduce((acc, p) => acc.plus(p.grossAmount), new Prisma.Decimal(0));
  const totalInssRetido = payouts.reduce((acc, p) => acc.plus(p.inssWithheld), new Prisma.Decimal(0));
  const totalInssPatronal = totalGross.mul(0.20);
  const totalDebitoConfessado = totalInssRetido.plus(totalInssPatronal);

  const builder = newBuilder();
  push(builder, ["D000", "DCTFWEB", competencia, (tenant.cnpj ?? "").replace(/\D/g, ""), tenant.legalName]);
  push(builder, ["D100", "INSS_SEGURADO_RETIDO", formatSpedAmount(totalInssRetido), "A_CONFIRMAR_TABELA_RFB_VIGENTE"]);
  push(builder, ["D100", "INSS_PATRONAL_PRO_LABORE", formatSpedAmount(totalInssPatronal), "A_CONFIRMAR_TABELA_RFB_VIGENTE"]);
  push(builder, ["D900", "DEBITO_CONFESSADO_TOTAL", formatSpedAmount(totalDebitoConfessado)]);
  push(builder, ["D999", String(builder.lines.length + 1)]);

  return { content: builder.lines.join("\r\n") + "\r\n", layoutVersion };
}

/**
 * Gera o Informe de Rendimentos do Sócio (documento interno entregue ao sócio para
 * sua própria DIRPF — nunca transmitido a um órgão, por isso não exige
 * `OfficialDocumentLayoutVersion`, ao contrário dos demais geradores deste arquivo;
 * ver comentário do enum `OfficialTaxDocumentType.INFORME_RENDIMENTOS_SOCIO`).
 */
export async function generateInformeRendimentosSocio(
  tenantId: string,
  partnerId: string,
  calendarYear: number,
): Promise<{ content: string }> {
  const partner = await prisma.companyPartner.findFirstOrThrow({ where: { id: partnerId, tenantId } });
  const payouts = await prisma.partnerPayout.findMany({
    where: { tenantId, partnerId, competencia: { startsWith: String(calendarYear) } },
    orderBy: { paidAt: "asc" },
  });

  const proLabore = payouts.filter((p) => p.type === "PRO_LABORE");
  const distribuicaoLucro = payouts.filter((p) => p.type === "PROFIT_DISTRIBUTION");
  const totalTributavel = proLabore.reduce((acc, p) => acc.plus(p.grossAmount), new Prisma.Decimal(0));
  const totalInssRetido = proLabore.reduce((acc, p) => acc.plus(p.inssWithheld), new Prisma.Decimal(0));
  const totalIrrfRetido = proLabore.reduce((acc, p) => acc.plus(p.irrfWithheld), new Prisma.Decimal(0));
  const totalIsento = distribuicaoLucro.reduce((acc, p) => acc.plus(p.grossAmount), new Prisma.Decimal(0));

  const builder = newBuilder();
  push(builder, ["INFORME_RENDIMENTOS", String(calendarYear), partner.cpf.replace(/\D/g, ""), partner.name]);
  push(builder, ["RENDIMENTO_TRIBUTAVEL_PRO_LABORE", formatSpedAmount(totalTributavel)]);
  push(builder, ["INSS_RETIDO_ANO", formatSpedAmount(totalInssRetido)]);
  push(builder, ["IRRF_RETIDO_ANO", formatSpedAmount(totalIrrfRetido)]);
  push(builder, ["RENDIMENTO_ISENTO_LUCROS_DISTRIBUIDOS", formatSpedAmount(totalIsento)]);
  push(builder, ["FIM"]);

  return { content: builder.lines.join("\r\n") + "\r\n" };
}
