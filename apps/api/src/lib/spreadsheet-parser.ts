// apps/api/src/lib/spreadsheet-parser.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.5 — "o lojista envia um CSV ou XLSX
// (parse via `exceljs` no backend, nunca no browser)". Helper compartilhado pela
// rota de sugestão de mapeamento (preview das 5 primeiras linhas) e pelo worker de
// validação (linha a linha) — um único ponto de parsing para os dois XLSX e CSV.
//
// `exceljs` lê XLSX nativamente via `workbook.xlsx.load(buffer)`. Para CSV, a API de
// stream de `exceljs` (`workbook.csv.read`) exige um `Readable` e se mostrou mais
// frágil com delimitadores/aspas de planilhas exportadas por diferentes ERPs
// concorrentes (requisito real deste módulo) do que um parser manual simples — por
// isso CSV é parseado por um splitter de linha/vírgula com suporte a aspas, o mesmo
// nível de robustez que um parser CSV básico precisa para este caso de uso.
import ExcelJS from "exceljs";

export type SpreadsheetRow = string[];

function parseCsvText(text: string): SpreadsheetRow[] {
  // Remove BOM UTF-8, se presente (comum em CSV exportado pelo Excel/Windows).
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const rows: SpreadsheetRow[] = [];
  const lines = normalized.split("\n").filter((line) => line.length > 0);
  for (const line of lines) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

/**
 * Lê um arquivo CSV ou XLSX (buffer já baixado do R2) e devolve todas as linhas como
 * matriz de strings (primeira linha = cabeçalho). `fileName` só é usado para decidir
 * o parser pela extensão.
 */
export async function parseSpreadsheetBuffer(buffer: Buffer, fileName: string): Promise<SpreadsheetRow[]> {
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  if (isCsv) {
    return parseCsvText(buffer.toString("utf-8"));
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: SpreadsheetRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // `row.values` é 1-indexado pelo exceljs (índice 0 sempre vazio) — descartamos o
    // índice 0 para alinhar com a matriz 0-indexada usada pelo resto do módulo.
    const values = row.values as unknown[];
    for (let i = 1; i < values.length; i++) {
      const value = values[i];
      if (value === null || value === undefined) {
        cells.push("");
      } else if (value instanceof Date) {
        cells.push(value.toISOString());
      } else if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
        // Célula com rich text/hyperlink do exceljs — usa só o texto.
        cells.push(String((value as { text: unknown }).text));
      } else {
        cells.push(String(value));
      }
    }
    rows.push(cells);
  });
  return rows;
}
