// apps/api/scripts/restore-encrypted-backup.mjs
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 10.3 — companion script de restauração do
// backup gerado por `src/workers/encrypted-database-backup.worker.ts` (dump lógico
// via Prisma, comprimido com gzip e cifrado em AES-256-GCM — ver nota de desvio de
// arquitetura no topo daquele worker: o runtime de produção é distroless, sem
// `pg_dump`, por isso o dump não é um `.sql` binário restaurável via `pg_restore`).
//
// Uso (rodado manualmente por um operador, NUNCA automatizado em produção):
//   BACKUP_ENCRYPTION_KEY=<hex64> DATABASE_URL=<postgres://...destino...> \
//     node apps/api/scripts/restore-encrypted-backup.mjs ./database-backup-2026-10-27.enc
//
// Formato do arquivo:
//   - Legado ("v1"): 12 bytes IV || 16 bytes authTag || ciphertext (gzip de um único
//     JSON `{ generatedAt, models: { ModelName: [...] } }`).
//   - Atual ("v2", fa-w4-backup-worker-oom): 4 bytes mágicos "FBK2" || 12 bytes IV ||
//     ciphertext (gzip de NDJSON, uma linha JSON por registro) || 16 bytes authTag no
//     FINAL do arquivo — reordenado em relação ao v1 porque o authTag do GCM só é
//     conhecido depois de cifrar TUDO, e o worker agora cifra em stream (nunca monta
//     o ciphertext inteiro em memória antes de gravar o arquivo).
// Importante: este script faz `createMany({ skipDuplicates: true })` por modelo, na
// ORDEM EM QUE OS MODELOS APARECEM NO DMMF (que já respeita, na prática, a ordem de
// declaração no schema.prisma — tabelas "pai" tendem a vir antes das "filhas", mas
// isto NÃO é uma garantia formal do Prisma). Em caso de erro de FK por ordem,
// rode o script novamente (idempotente via `skipDuplicates`) — registros cuja FK já
// foi inserida na rodada anterior entram normalmente na segunda passada.
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const [, , filePath] = process.argv;
if (!filePath) {
  console.error("Uso: node restore-encrypted-backup.mjs <arquivo.enc>");
  process.exit(1);
}

const backupKeyHex = process.env.BACKUP_ENCRYPTION_KEY;
if (!backupKeyHex) {
  console.error("Defina BACKUP_ENCRYPTION_KEY (mesma chave usada para cifrar este backup) antes de rodar.");
  process.exit(1);
}
const backupKey = Buffer.from(backupKeyHex, "hex");

const fileBuffer = readFileSync(filePath);
const STREAMING_FORMAT_MAGIC = Buffer.from("FBK2", "ascii");
const isStreamingFormat = fileBuffer.subarray(0, 4).equals(STREAMING_FORMAT_MAGIC);

let iv;
let authTag;
let ciphertext;
if (isStreamingFormat) {
  iv = fileBuffer.subarray(4, 16);
  authTag = fileBuffer.subarray(fileBuffer.length - 16);
  ciphertext = fileBuffer.subarray(16, fileBuffer.length - 16);
} else {
  iv = fileBuffer.subarray(0, 12);
  authTag = fileBuffer.subarray(12, 28);
  ciphertext = fileBuffer.subarray(28);
}

const decipher = createDecipheriv("aes-256-gcm", backupKey, iv);
decipher.setAuthTag(authTag);
const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
const decompressed = gunzipSync(compressed).toString("utf8");

// Reverte o replacer de `backupJsonReplacer` (Date/Buffer/BigInt/Decimal marcados
// com `__type`) — o reviver é o espelho exato da serialização do worker.
function backupJsonReviver(_key, value) {
  if (value && typeof value === "object" && typeof value.__type === "string") {
    if (value.__type === "Date") return new Date(value.value);
    if (value.__type === "Buffer") return Buffer.from(value.value, "base64");
    if (value.__type === "BigInt") return BigInt(value.value);
    if (value.__type === "Decimal") return value.value; // Prisma aceita string para campos Decimal em `createMany`
  }
  return value;
}

/** Reconstrói o mesmo formato em memória `{ generatedAt, models: { ModelName: [...] } }` a partir do NDJSON v2, para reaproveitar o loop de restauração abaixo sem duplicar lógica. */
function parseStreamingNdjson(text) {
  const models = {};
  let generatedAt = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line, backupJsonReviver);
    if (parsed.__meta) {
      generatedAt = parsed.generatedAt;
      continue;
    }
    if (parsed.__model) {
      if (!models[parsed.__model]) models[parsed.__model] = [];
      models[parsed.__model].push(parsed.row);
    }
  }
  return { generatedAt, models };
}

const parsed = isStreamingFormat ? parseStreamingNdjson(decompressed) : JSON.parse(decompressed, backupJsonReviver);
const prisma = new PrismaClient();

function toLowerCamelDelegateName(modelName) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

async function main() {
  console.log(`Backup gerado em ${parsed.generatedAt}. Restaurando ${Object.keys(parsed.models).length} modelos...`);
  for (const [modelName, rows] of Object.entries(parsed.models)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const delegateName = toLowerCamelDelegateName(modelName);
    const delegate = prisma[delegateName];
    if (!delegate || typeof delegate.createMany !== "function") {
      console.warn(`Modelo "${modelName}" sem delegate createMany válido — pulando (${rows.length} linhas não restauradas).`);
      continue;
    }
    try {
      const result = await delegate.createMany({ data: rows, skipDuplicates: true });
      console.log(`${modelName}: ${result.count}/${rows.length} linhas restauradas.`);
    } catch (error) {
      console.error(`${modelName}: falha ao restaurar — ${error.message}`);
    }
  }
  await prisma.$disconnect();
  console.log("Restauração concluída. Rode novamente este script se alguma tabela falhou por ordem de FK.");
}

main().catch((error) => {
  console.error("Falha fatal na restauração:", error);
  process.exit(1);
});
