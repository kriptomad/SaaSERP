// Autor: Bruno Costa
// Extrai todos os blocos ```prisma do BIBLE_ENGINEERING_V2.md e monta um schema.prisma único,
// mantendo apenas blocos que de fato declaram `model`/`enum`/`generator`/`datasource`
// (ignora blocos de comentário/referência cruzada usados só como nota de leitura na Bible).
const fs = require("fs");
const path = require("path");

// GAP DE AUDITORIA FECHADO (fa-infra-hardcoded-author-path): o caminho da Bible era
// fixo na máquina do autor (`C:\Users\costabr\Downloads\...`), falhando em qualquer
// outra máquina/CI. Agora aceita o caminho via primeiro argumento de CLI ou via
// variável de ambiente `BIBLE_ENGINEERING_PATH`, valida a existência do arquivo antes
// de ler e encerra com código de saída != 0 em caso de erro (nunca sobrescreve o
// schema.prisma versionado com conteúdo parcial/vazio).
const bibliaPath = process.argv[2] ?? process.env.BIBLE_ENGINEERING_PATH;
const outPath = path.join(__dirname, "..", "packages", "db", "prisma", "schema.prisma");

if (!bibliaPath) {
  console.error(
    "Uso: node scripts/extract-schema.js <caminho-para-BIBLE_ENGINEERING_V2.md>\n" +
      "(ou defina a variável de ambiente BIBLE_ENGINEERING_PATH)",
  );
  process.exit(1);
}

if (!fs.existsSync(bibliaPath)) {
  console.error(`Arquivo não encontrado: ${bibliaPath}`);
  process.exit(1);
}

const content = fs.readFileSync(bibliaPath, "utf-8");
const lines = content.split(/\r?\n/);

let inFence = false;
let current = [];
const blocks = [];

for (const line of lines) {
  if (/^```prisma/.test(line)) {
    inFence = true;
    current = [];
    continue;
  }
  if (inFence && /^```/.test(line)) {
    inFence = false;
    blocks.push(current.join("\n"));
    continue;
  }
  if (inFence) current.push(line);
}

console.log(`Total de blocos \`\`\`prisma encontrados: ${blocks.length}`);

const realBlocks = blocks.filter((b) => /^(model|enum|generator|datasource)\s/m.test(b));
console.log(`Blocos com declaração real (model/enum/generator/datasource): ${realBlocks.length}`);

if (realBlocks.length === 0) {
  console.error("Nenhum bloco ```prisma com declaração real encontrado — abortando sem sobrescrever schema.prisma.");
  process.exit(1);
}

const header = `// Gerado a partir de BIBLE_ENGINEERING_V2.md (Capítulo 5 e extensões) — Autor: Bruno Costa
// NÃO EDITAR MANUALMENTE o bloco gerado automaticamente sem atualizar a Bible correspondente.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

`;

fs.writeFileSync(outPath, header + realBlocks.join("\n\n") + "\n", "utf-8");
console.log(`Schema escrito em: ${outPath}`);
