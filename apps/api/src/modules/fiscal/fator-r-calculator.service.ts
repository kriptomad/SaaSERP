// apps/api/src/modules/fiscal/fator-r-calculator.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.8 — Fator "r" do Simples Nacional
// (LC 123/2006, art. 18, §5º-J). Prestadores de serviço (ex.: Assistência Técnica)
// tributados pelo Anexo V (mais caro) podem migrar automaticamente para o Anexo III
// (mais barato) quando a folha de pagamento dos últimos 12 meses representar 28% ou
// mais do seu faturamento bruto no mesmo período — cálculo mensal, nunca estático.
//
// Fonte de dados da folha: não existe um módulo de RH/eSocial dedicado neste
// schema — por isso o Capítulo 17.1/21.8 já previa que a folha fosse rastreada como
// `AccountPayable` PAGA classificada no `CostCenter.code = "FOLHA_PAGAMENTO"`
// (ver comentário em `AccountPayable.costCenterId`), e é essa a fonte usada aqui.
import { Prisma, TenantScopedPrismaClient } from "@filitech/db";

export interface FatorRResult {
  fatorR: Prisma.Decimal;
  anexo: "III" | "V";
  folhaUltimos12Meses: Prisma.Decimal;
  faturamentoUltimos12Meses: Prisma.Decimal;
}

export async function resolveServiceAnexo(prisma: TenantScopedPrismaClient, tenantId: string, referenceDate: Date = new Date()): Promise<FatorRResult> {
  const twelveMonthsAgo = new Date(referenceDate);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const [faturamento, folhaCostCenter] = await Promise.all([
    prisma.sale.aggregate({
      where: { tenantId, status: "PAID", createdAt: { gte: twelveMonthsAgo, lte: referenceDate } },
      _sum: { totalAmount: true },
    }),
    prisma.costCenter.findUnique({ where: { tenantId_code: { tenantId, code: "FOLHA_PAGAMENTO" } } }),
  ]);

  const faturamentoUltimos12Meses = faturamento._sum.totalAmount ?? new Prisma.Decimal(0);

  // Sem centro de custo "FOLHA_PAGAMENTO" cadastrado ou sem faturamento no período
  // (tenant novo) — assume o Anexo mais caro (V) por segurança fiscal até haver
  // dados suficientes para apurar o fator real; nunca assume Anexo III sem prova.
  if (!folhaCostCenter || faturamentoUltimos12Meses.isZero()) {
    return { fatorR: new Prisma.Decimal(0), anexo: "V", folhaUltimos12Meses: new Prisma.Decimal(0), faturamentoUltimos12Meses };
  }

  const folha = await prisma.accountPayable.aggregate({
    where: { tenantId, costCenterId: folhaCostCenter.id, status: "PAID", paidAt: { gte: twelveMonthsAgo, lte: referenceDate } },
    _sum: { amount: true },
  });
  const folhaUltimos12Meses = folha._sum.amount ?? new Prisma.Decimal(0);

  const fatorR = folhaUltimos12Meses.div(faturamentoUltimos12Meses);
  const anexo = fatorR.gte(0.28) ? "III" : "V";

  return { fatorR, anexo, folhaUltimos12Meses, faturamentoUltimos12Meses };
}
