// Autor: Bruno Costa
// Extrai todos os blocos ```prisma do BIBLE_ENGINEERING_V2.md e monta um schema.prisma único,
// mantendo apenas blocos que de fato declaram `model`/`enum`/`generator`/`datasource`
// (ignora blocos de comentário/referência cruzada usados só como nota de leitura na Bible).
const fs = require("fs");
const path = require("path");

const bibliaPath = "C:\\Users\\costabr\\Downloads\\BIBLE_ENGINEERING_V2.md";
const outPath = path.join(__dirname, "..", "packages", "db", "prisma", "schema.prisma");

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
