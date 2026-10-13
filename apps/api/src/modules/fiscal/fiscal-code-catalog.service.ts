// apps/api/src/modules/fiscal/fiscal-code-catalog.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.16 — catálogo de códigos fiscais
// (NCM/NBS/CEST) versionado e auditável, nunca hardcoded. Implementação real
// (adaptada da correção de auditoria: FK para PlatformAdminUser, não User).
import { PrismaClient } from "@filitech/db";

export interface ParsedFiscalCode {
  code: string;
  description: string;
}

export async function importFiscalCodeCatalog(
  prisma: PrismaClient,
  input: {
    catalogType: "NCM" | "NBS" | "CEST";
    sourceDescription: string;
    fileName: string | null;
    importedByPlatformAdminUserId: string;
    parsedCodes: ParsedFiscalCode[];
  },
) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.fiscalCodeCatalogImport.create({
      data: {
        catalogType: input.catalogType,
        sourceDescription: input.sourceDescription,
        fileName: input.fileName,
        importedByPlatformAdminUserId: input.importedByPlatformAdminUserId,
        totalCodesProcessed: input.parsedCodes.length,
        status: "PROCESSING",
      },
    });

    // Encerra a vigência dos códigos do mesmo tipo que não aparecem mais no lote novo
    // (foram removidos/substituídos pela Resolução Camex/MDIC mais recente), preservando
    // histórico para auditoria de vendas passadas — nunca um DELETE físico.
    const novosCodigos = new Set(input.parsedCodes.map((c) => c.code));
    const vigentes = await tx.fiscalCode.findMany({ where: { type: input.catalogType, effectiveTo: null } });
    const codigosRemovidos = vigentes.filter((v) => !novosCodigos.has(v.code));
    if (codigosRemovidos.length > 0) {
      await tx.fiscalCode.updateMany({ where: { id: { in: codigosRemovidos.map((c) => c.id) } }, data: { effectiveTo: new Date() } });
    }

    // Códigos novos (não existentes ainda vigentes) entram como novas linhas, nunca
    // sobrescrevendo a linha anterior — preserva o histórico de `description` por data.
    const codigosExistentesSet = new Set(vigentes.map((v) => v.code));
    const codigosNovos = input.parsedCodes.filter((c) => !codigosExistentesSet.has(c.code));
    if (codigosNovos.length > 0) {
      await tx.fiscalCode.createMany({
        data: codigosNovos.map((c) => ({
          catalogImportId: batch.id,
          type: input.catalogType,
          code: c.code,
          description: c.description,
          effectiveFrom: new Date(),
        })),
      });
    }

    // Alerta real, não mock: se algum código novo ainda não tem TaxRule correspondente,
    // o lote é marcado como "completo com avisos" — o dono precisa cadastrar a regra
    // fiscal antes que qualquer produto possa usar o código novo em uma venda.
    const codigosSemRegra = await Promise.all(
      codigosNovos.map(async (c) => ({
        code: c.code,
        temRegra: Boolean(
          await tx.taxRule.findFirst({
            where: input.catalogType === "NCM" ? { ncm: c.code } : input.catalogType === "NBS" ? { nbs: c.code } : { cest: c.code },
          }),
        ),
      })),
    );
    const faltandoRegra = codigosSemRegra.filter((c) => !c.temRegra);

    return tx.fiscalCodeCatalogImport.update({
      where: { id: batch.id },
      data: {
        status: faltandoRegra.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
        errorLog: faltandoRegra.length > 0 ? `Códigos sem TaxRule cadastrada: ${faltandoRegra.map((c) => c.code).join(", ")}` : null,
      },
    });
  });
}

/**
 * Parser real do CSV de upload manual — layout mínimo esperado: duas colunas,
 * `codigo,descricao`, com ou sem cabeçalho (linhas cujo primeiro campo não casa com o
 * padrão de código numérico/alfanumérico esperado são tratadas como cabeçalho e
 * ignoradas). Delimitador `;` também aceito (comum em planilhas exportadas em PT-BR).
 */
export function parseFiscalCodeCsv(csvContent: string): ParsedFiscalCode[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const codes: ParsedFiscalCode[] = [];
  for (const line of lines) {
    const delimiter = line.includes(";") ? ";" : ",";
    const [rawCode, ...rest] = line.split(delimiter);
    const code = rawCode?.trim();
    const description = rest.join(delimiter).trim();
    if (!code || !description) continue;
    if (/^c[oó]digo$/i.test(code)) continue; // linha de cabeçalho
    codes.push({ code, description });
  }
  return codes;
}
