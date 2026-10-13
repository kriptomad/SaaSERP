// apps/api/src/lib/ofx-parser.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.4 (Conciliação Bancária — importação
// manual de extrato OFX). Parser mínimo e sem dependências externas: o formato OFX
// (versão SGML, ainda a mais usada pelos bancos brasileiros para exportação manual de
// extrato) é um formato de tags não fechadas (`<FITID>202501150001` sem `</FITID>`),
// então não é parseável por um parser XML/HTML padrão — implementado aqui com um
// extrator de blocos `<STMTTRN>...</STMTTRN>` + regex por tag, nunca um "stub" que só
// aceita um formato de exemplo.
export interface ParsedOfxTransaction {
  fitId: string;
  trnType: string;
  postedAt: Date;
  amount: number;
  description: string;
}

function extractTag(block: string, tag: string): string | null {
  // Tags OFX SGML não são fechadas no mesmo nível (ex.: <FITID>ABC123<TRNTYPE>...),
  // então o valor termina no próximo `<` (abertura de outra tag) ou quebra de linha.
  const match = block.match(new RegExp(`<${tag}>([^<\r\n]*)`, "i"));
  return match ? match[1].trim() : null;
}

function parseOfxDate(raw: string): Date {
  // Formato OFX: YYYYMMDDHHMMSS[.sss][ +TZ]. Extrai sempre os 8 primeiros dígitos
  // (data), ignorando hora/timezone — suficiente para conciliação por dia.
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 8);
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day));
}

export class InvalidOfxContentError extends Error {}

export function parseOfxTransactions(ofxContent: string): ParsedOfxTransaction[] {
  const blocks = ofxContent.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi);
  if (!blocks || blocks.length === 0) {
    throw new InvalidOfxContentError("Arquivo OFX inválido ou sem transações (<STMTTRN> não encontrado).");
  }

  return blocks.map((block) => {
    const fitId = extractTag(block, "FITID");
    const trnType = extractTag(block, "TRNTYPE") ?? "OTHER";
    const dtPosted = extractTag(block, "DTPOSTED");
    const trnAmt = extractTag(block, "TRNAMT");
    const name = extractTag(block, "NAME") ?? extractTag(block, "PAYEE") ?? "";
    const memo = extractTag(block, "MEMO") ?? "";

    if (!fitId || !dtPosted || !trnAmt) {
      throw new InvalidOfxContentError("Transação OFX sem FITID/DTPOSTED/TRNAMT — extrato corrompido ou incompleto.");
    }

    return {
      fitId,
      trnType,
      postedAt: parseOfxDate(dtPosted),
      amount: Number(trnAmt),
      description: [name, memo].filter(Boolean).join(" — ") || "Transação sem descrição",
    };
  });
}
