// apps/api/src/modules/reports/report-export.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.2 — exportação de relatórios em
// PDF/XLSX (pendência explicitamente flagada em reports.routes.ts quando as
// libs ainda não estavam instaladas). Gera o arquivo em memória (Buffer) a
// partir das mesmas linhas retornadas por `executeReportDefinition()` — nunca
// duplica a lógica de consulta/agregação, apenas serializa o resultado.
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export type ReportRow = Record<string, unknown>;

function inferColumns(rows: ReportRow[]): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return Array.from(columns);
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleString("pt-BR");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export async function buildReportXlsx(reportName: string, rows: ReportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Filitech ERP";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(reportName.slice(0, 31) || "Relatório");

  const columns = inferColumns(rows);
  sheet.columns = columns.map((key) => ({ header: key, key, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(columns.map((key) => formatCell(row[key])));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildReportPdf(reportName: string, rows: ReportRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(reportName, { align: "left" });
    doc.fontSize(9).fillColor("#666666").text(`Gerado em ${new Date().toLocaleString("pt-BR")} — Filitech ERP`, { align: "left" });
    doc.moveDown(1);

    const columns = inferColumns(rows);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = columns.length > 0 ? pageWidth / columns.length : pageWidth;

    doc.fontSize(9).fillColor("#000000");
    const headerY = doc.y;
    columns.forEach((col, i) => {
      doc.text(col, doc.page.margins.left + i * colWidth, headerY, { width: colWidth, ellipsis: true });
    });
    doc.moveDown(1);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.3);

    for (const row of rows) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage({ margin: 36, size: "A4", layout: "landscape" });
      }
      const rowY = doc.y;
      columns.forEach((col, i) => {
        doc.text(formatCell(row[col]), doc.page.margins.left + i * colWidth, rowY, { width: colWidth, ellipsis: true });
      });
      doc.moveDown(0.6);
    }

    doc.end();
  });
}
