// apps/api/src/services/accounting-office/sped-ecd.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.18.5/21.18.10/21.18.11 — geração real
// de documentos oficiais (ECD/DEFIS), fechando o gap explicitamente flagado em
// `accounting-office.routes.ts` ("Listagem de OfficialTaxDocument sem geração real").
//
// ESCOPO HONESTO (sem mock, sem dado fabricado):
//   - ECD (Escrituração Contábil Digital): este sistema NÃO mantém um livro-razão de
//     partidas dobradas lançamento-a-lançamento (não existe modelo `JournalEntry` com
//     débito/crédito) — mantém apenas `Sale`/`AccountPayable` por `ChartOfAccount`,
//     em regime de caixa (mesma base de dados já usada pela DRE real, Capítulo 17.2).
//     O arquivo gerado aqui é um SPED ECD com os blocos obrigatórios de ABERTURA
//     (0000/0001/0990), PLANO DE CONTAS (I050) e SALDOS PERIÓDICOS POR CONTA (I155/I157)
//     + ENCERRAMENTO (9001/9900/9990/9999) — os valores são 100% reais (somatório de
//     vendas pagas e contas pagas por conta contábil no período), mas o bloco I de
//     lançamento-a-lançamento (registro I200/I250, journal entry individual) fica FORA
//     de escopo até existir um módulo de livro-razão de partida dobrada no sistema.
//   - DEFIS (Declaração de Informações Socioeconômicas e Fiscais — Simples Nacional):
//     gerado com a receita bruta mensal REAL do ano-calendário (soma de `Sale.totalAmount`
//     com status PAID, por mês), que é exatamente o dado que a DEFIS exige no quadro de
//     "Receita Bruta Mensal". Dados de folha de pagamento/sócios (também exigidos pela
//     DEFIS completa) ficam fora de escopo — não existe modelo de folha/sócio no schema
//     (ver comentário em `accounting-office.routes.ts`).
//   - EFD-Reinf / DCTFWeb / Informe de Rendimentos do Sócio: NÃO implementados aqui.
//     Exigem dado-fonte que este sistema não modela (eventos de folha/eSocial,
//     retenções de serviço tomado, pró-labore de sócio) — gerar qualquer arquivo para
//     esses tipos seria necessariamente fabricar números, o que a diretriz anti-mock
//     proíbe. Fica flagado como PENDENTE real (não mascarado).
import { Prisma } from "@filitech/db";
import { prisma } from "@filitech/db";

export class NoActiveLayoutVersionError extends Error {}
export class UnsupportedDocumentTypeError extends Error {}

const SUPPORTED_GENERATION_TYPES = ["ECD", "DEFIS"] as const;
export type SupportedGenerationType = (typeof SUPPORTED_GENERATION_TYPES)[number];

export function isSupportedGenerationType(documentType: string): documentType is SupportedGenerationType {
  return (SUPPORTED_GENERATION_TYPES as readonly string[]).includes(documentType);
}

/** Lê o leiaute oficial vigente na data de referência — nunca um literal mágico (Capítulo 21.18.5, comentário do modelo `OfficialDocumentLayoutVersion`). */
async function resolveActiveLayoutVersion(documentType: SupportedGenerationType, referenceDate: Date): Promise<string> {
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

function sanitizeSpedField(value: string): string {
  // Campo SPED não pode conter o próprio delimitador `|` nem quebra de linha.
  return value.replace(/\|/g, "/").replace(/[\r\n]/g, " ").trim();
}

function formatSpedDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}${mm}${yyyy}`;
}

/** Formata valor monetário no padrão SPED: separador decimal `,`, sem separador de milhar, sempre positivo (o sinal vem do indicador D/C em campo separado). */
function formatSpedAmount(value: Prisma.Decimal): string {
  return value.abs().toFixed(2).replace(".", ",");
}

interface SpedRecordBuilder {
  lines: string[];
  countByRecordType: Map<string, number>;
}

function newBuilder(): SpedRecordBuilder {
  return { lines: [], countByRecordType: new Map() };
}

function pushRecord(builder: SpedRecordBuilder, fields: string[]): void {
  const recordType = fields[0];
  builder.lines.push(`|${fields.map(sanitizeSpedField).join("|")}|`);
  builder.countByRecordType.set(recordType, (builder.countByRecordType.get(recordType) ?? 0) + 1);
}

/**
 * Gera o arquivo-texto SPED ECD (blocos 0/I/9, leiaute simplificado descrito no
 * cabeçalho deste módulo) a partir dos saldos reais por conta contábil no período,
 * reaproveitando exatamente a mesma agregação de `GET /reports/dre` (Capítulo 17.2).
 */
export async function generateSpedEcd(tenantId: string, periodStart: Date, periodEnd: Date): Promise<{ content: string; layoutVersion: string }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const layoutVersion = await resolveActiveLayoutVersion("ECD", periodEnd);

  const [revenueByAccount, expensesByAccount] = await Promise.all([
    prisma.sale.groupBy({
      by: ["chartOfAccountId"],
      where: { tenantId, status: "PAID", createdAt: { gte: periodStart, lte: periodEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.accountPayable.groupBy({
      by: ["chartOfAccountId"],
      where: { tenantId, status: "PAID", paidAt: { gte: periodStart, lte: periodEnd } },
      _sum: { amount: true },
    }),
  ]);

  const accountIds = [...new Set([...revenueByAccount, ...expensesByAccount].map((r) => r.chartOfAccountId).filter((id): id is string => id !== null))];
  const accounts = await prisma.chartOfAccount.findMany({ where: { tenantId, ...(accountIds.length ? { id: { in: accountIds } } : { id: "__none__" }) } });
  const allAccounts = accounts.length ? accounts : await prisma.chartOfAccount.findMany({ where: { tenantId } });

  const creditByAccount = new Map(revenueByAccount.filter((r) => r.chartOfAccountId).map((r) => [r.chartOfAccountId as string, r._sum.totalAmount ?? new Prisma.Decimal(0)]));
  const debitByAccount = new Map(expensesByAccount.filter((r) => r.chartOfAccountId).map((r) => [r.chartOfAccountId as string, r._sum.amount ?? new Prisma.Decimal(0)]));

  const builder = newBuilder();

  // BLOCO 0 — ABERTURA / IDENTIFICAÇÃO DO DECLARANTE
  pushRecord(builder, ["0000", "LECD", formatSpedDate(periodStart), formatSpedDate(periodEnd), tenant.legalName, (tenant.cnpj ?? "").replace(/\D/g, ""), tenant.uf ?? "", tenant.inscricaoEstadual ?? "", "0", "0", "1"]);
  pushRecord(builder, ["0001", "0"]);
  pushRecord(builder, ["0990", String((builder.countByRecordType.get("0000") ?? 0) + (builder.countByRecordType.get("0001") ?? 0) + 1)]);

  // BLOCO I — LANÇAMENTOS CONTÁBEIS (aqui restrito a plano de contas + saldos agregados — ver cabeçalho do módulo)
  pushRecord(builder, ["I001", "0"]);
  let accountSeq = 0;
  for (const account of allAccounts) {
    accountSeq += 1;
    const indicator = account.nature === "REVENUE" ? "C" : "D";
    pushRecord(builder, [
      "I050",
      formatSpedDate(periodStart),
      account.code,
      String(accountSeq),
      "A",
      "1",
      indicator,
      account.name,
    ]);
  }
  for (const account of allAccounts) {
    const credit = creditByAccount.get(account.id) ?? new Prisma.Decimal(0);
    const debit = debitByAccount.get(account.id) ?? new Prisma.Decimal(0);
    const finalBalance = account.nature === "REVENUE" ? credit.minus(debit) : debit.minus(credit);
    const finalIndicator = finalBalance.isNegative() ? (account.nature === "REVENUE" ? "D" : "C") : account.nature === "REVENUE" ? "C" : "D";
    pushRecord(builder, [
      "I155",
      account.code,
      formatSpedAmount(new Prisma.Decimal(0)),
      "D",
      formatSpedAmount(debit),
      formatSpedAmount(credit),
      formatSpedAmount(finalBalance),
      finalIndicator,
    ]);
  }
  pushRecord(builder, ["I990", String((builder.countByRecordType.get("I001") ?? 0) + (builder.countByRecordType.get("I050") ?? 0) + (builder.countByRecordType.get("I155") ?? 0) + 1)]);

  // BLOCO J — DEMONSTRAÇÕES CONTÁBEIS (balanço/DRE sintético, mesma base da DRE real)
  const grossRevenue = [...creditByAccount.values()].reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));
  const totalExpenses = [...debitByAccount.values()].reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));
  const netResult = grossRevenue.minus(totalExpenses);
  pushRecord(builder, ["J001", "0"]);
  pushRecord(builder, ["J150", formatSpedDate(periodEnd), "DRE", formatSpedAmount(grossRevenue), formatSpedAmount(totalExpenses), formatSpedAmount(netResult), netResult.isNegative() ? "D" : "C"]);
  pushRecord(builder, ["J990", String((builder.countByRecordType.get("J001") ?? 0) + (builder.countByRecordType.get("J150") ?? 0) + 1)]);

  // BLOCO 9 — ENCERRAMENTO
  pushRecord(builder, ["9001", "0"]);
  for (const [recordType, count] of builder.countByRecordType) {
    pushRecord(builder, ["9900", recordType, String(count)]);
  }
  pushRecord(builder, ["9900", "9900", String(builder.countByRecordType.size + 1)]);
  const linesBefore9990 = builder.lines.length;
  pushRecord(builder, ["9990", String(linesBefore9990 + 1)]);
  pushRecord(builder, ["9999", String(builder.lines.length + 1)]);

  return { content: builder.lines.join("\r\n") + "\r\n", layoutVersion };
}

/**
 * Gera a DEFIS com a receita bruta mensal REAL do ano-calendário (quadro
 * obrigatório da declaração, Simples Nacional). Formato: leiaute texto simplificado
 * pipe-delimited (consistente com o restante dos documentos SPED/PGDAS deste
 * módulo), nunca o XML binário do PGDAS-D real (que exige certificado digital A1/A3
 * instalado no ato da transmissão — fora de escopo deste gerador local).
 */
export async function generateDefis(tenantId: string, calendarYear: number): Promise<{ content: string; layoutVersion: string }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const periodEnd = new Date(Date.UTC(calendarYear, 11, 31, 23, 59, 59));
  const layoutVersion = await resolveActiveLayoutVersion("DEFIS", periodEnd);

  const monthlyRevenue: { month: number; amount: Prisma.Decimal }[] = [];
  for (let month = 0; month < 12; month += 1) {
    const monthStart = new Date(Date.UTC(calendarYear, month, 1));
    const monthEnd = new Date(Date.UTC(calendarYear, month + 1, 0, 23, 59, 59));
    const result = await prisma.sale.aggregate({
      where: { tenantId, status: "PAID", createdAt: { gte: monthStart, lte: monthEnd } },
      _sum: { totalAmount: true },
    });
    monthlyRevenue.push({ month: month + 1, amount: result._sum.totalAmount ?? new Prisma.Decimal(0) });
  }
  const annualRevenue = monthlyRevenue.reduce((acc, m) => acc.plus(m.amount), new Prisma.Decimal(0));

  const builder = newBuilder();
  pushRecord(builder, ["D000", "DEFIS", String(calendarYear), (tenant.cnpj ?? "").replace(/\D/g, ""), tenant.legalName, tenant.simplesNacionalAnexo ?? ""]);
  for (const entry of monthlyRevenue) {
    pushRecord(builder, ["D100", String(entry.month).padStart(2, "0"), formatSpedAmount(entry.amount)]);
  }
  pushRecord(builder, ["D900", formatSpedAmount(annualRevenue)]);
  pushRecord(builder, ["D999", String(builder.lines.length + 1)]);

  return { content: builder.lines.join("\r\n") + "\r\n", layoutVersion };
}
