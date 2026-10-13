// apps/api/src/modules/fiscal/ibs-cbs-regime-resolver.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.15 (b) — a ÚNICA opção real de
// "ligar/desligar" algo relacionado à Reforma Tributária que a lei de fato permite:
// o Simples Nacional pode eleger apurar IBS/CBS "por fora" do DAS (REGULAR_COM_CREDITO)
// em vez do padrão embutido no DAS (EMBUTIDO_NO_DAS). Fora do Simples, não existe
// eleição: Lucro Presumido/Real já apuram no regime regular por definição legal.
import { Prisma, PrismaClient, type IbsCbsRegimeOptante } from "@filitech/db";

export async function resolveIbsCbsRegimeForTenant(
  prisma: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  saleDate: Date,
): Promise<IbsCbsRegimeOptante> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { taxRegime: true } });

  if (tenant.taxRegime !== "SIMPLES_NACIONAL") return "REGULAR_COM_CREDITO";

  const semestreVendaRef = `${saleDate.getFullYear()}-S${saleDate.getMonth() < 6 ? "1" : "2"}`;
  const election = await prisma.tenantIbsCbsRegimeElection.findFirst({
    where: { tenantId, semestreReferencia: { lte: semestreVendaRef } },
    orderBy: { semestreReferencia: "desc" },
  });

  return election?.regime ?? "EMBUTIDO_NO_DAS";
}

/**
 * Calcula a janela de adesão vigente para um semestre de referência — usada para
 * validar o pedido de eleição antes de persistir (Capítulo 21.15: "janela semestral
 * e irrevogável", nunca aceita fora do período oficial).
 *
 * Regra real: a janela de adesão é setembro-outubro do ano anterior ao semestre-alvo
 * (ex.: para aderir ao 2º semestre de 2027, a janela é set-out/2026), EXCETO a janela
 * excepcional de 1º/set a 30/out/2026 que vale também para o 1º semestre de 2027
 * (criada pela própria lei para cobrir o primeiro ano de vigência do IVA dual, quando
 * não haveria tempo hábil de abrir uma janela regular doze meses antes).
 */
export function resolveElectionWindow(semestreReferencia: string): { janelaAbreEm: Date; janelaFechaEm: Date } {
  const [anoStr, semestre] = semestreReferencia.split("-S");
  const ano = Number(anoStr);

  if (semestreReferencia === "2027-S1") {
    // Janela excepcional prevista na própria LC 214/2025 para o semestre de estreia.
    return { janelaAbreEm: new Date(Date.UTC(2026, 8, 1)), janelaFechaEm: new Date(Date.UTC(2026, 9, 30, 23, 59, 59)) };
  }

  // Regra geral: a janela sempre abre em 1º/set e fecha em 30/out do ano anterior ao
  // semestre a que a eleição se refere (independente de ser S1 ou S2 do ano seguinte).
  const anoJanela = semestre === "1" ? ano - 1 : ano;
  return {
    janelaAbreEm: new Date(Date.UTC(anoJanela, 8, 1)),
    janelaFechaEm: new Date(Date.UTC(anoJanela, 9, 30, 23, 59, 59)),
  };
}
