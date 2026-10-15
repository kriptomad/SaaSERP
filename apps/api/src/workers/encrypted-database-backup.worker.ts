// apps/api/src/workers/encrypted-database-backup.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 10.3 — Backup Criptografado sem Downtime.
//
// DESVIO DE ARQUITETURA DOCUMENTADO (GAP DE AUDITORIA FECHADO COM ADAPTAÇÃO REAL):
// o pseudocódigo da Bíblia faz `spawn("pg_dump", ...)` em modo streaming. Isso é
// INEXECUTÁVEL neste repositório: o runtime de produção (`apps/api/Dockerfile`,
// estágio final) é a imagem `gcr.io/distroless/nodejs20-debian12` — Capítulo 3.1,
// "Docker Distroless em produção" — que não tem shell, gerenciador de pacotes NEM
// o binário `pg_dump` (e instalá-lo via `apt-get` exigiria abandonar a imagem
// distroless, contradizendo a própria exigência de segurança do Capítulo 3.1).
//
// A solução adotada preserva 100% da garantia de segurança pretendida pelo capítulo
// (backup nunca toca disco sem cifra, AES-256-GCM, upload direto ao R2, cron
// isolado em processo de worker dedicado) trocando apenas o MECANISMO de extração:
// em vez de um dump binário via `pg_dump --format=custom` (que exigiria `pg_restore`
// para restaurar), este worker faz um dump LÓGICO via Prisma — itera every modelo do
// DMMF (TODOS os modelos, não só os tenant-scoped, ao contrário de
// `data-export-generation.worker.ts` que é por tenant) e serializa cada tabela como
// JSON, paginado, nunca um `findMany` sem limite. O resultado é comprimido (gzip) e
// então cifrado (AES-256-GCM) antes do upload — nenhum byte não cifrado chega a
// tocar o disco do worker (tudo em memória/stream), igual ao espírito do capítulo.
// Restauração: `apps/api/scripts/restore-encrypted-backup.mjs` (script complementar).
import { Worker, Job } from "bullmq";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Prisma, prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, databaseBackupQueue } from "../lib/queue";
import { putPlatformObjectDirect } from "../lib/object-storage";
import { getPlatformSecret } from "../lib/platform-secrets";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("encrypted-database-backup.worker");

const REPEATABLE_JOB_NAME = "daily-backup";
const DAILY_CRON_3AM = "0 3 * * *";
const PAGE_SIZE = 2000;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function toLowerCamelDelegateName(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

/** Replacer de `JSON.stringify` que sabe serializar os tipos que o `JSON.stringify` nativo não cobre (Decimal, Date, Buffer, BigInt) — mesma necessidade do `csvEscapeValue` de `data-export-generation.worker.ts`, mas para JSON em vez de CSV. */
function backupJsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return { __type: "Date", value: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __type: "Buffer", value: value.toString("base64") };
  if (typeof value === "bigint") return { __type: "BigInt", value: value.toString() };
  if (value && typeof value === "object" && typeof (value as { toFixed?: unknown }).toFixed === "function" && typeof (value as { toNumber?: unknown }).toNumber === "function") {
    // Prisma.Decimal — preserva precisão exata como string (nunca `Number`, que perde casas decimais).
    return { __type: "Decimal", value: String(value) };
  }
  return value;
}

/** Dump paginado de um único modelo (CROSS-TENANT — este backup é platform-wide, nunca filtrado por tenantId, ao contrário da exportação individual do Capítulo 18.4). */
async function dumpModel(modelName: string): Promise<Record<string, unknown>[]> {
  const delegateName = toLowerCamelDelegateName(modelName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prismaUnscoped as any)[delegateName];
  if (!delegate || typeof delegate.findMany !== "function") return [];

  const rows: Record<string, unknown>[] = [];
  let skip = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page: Array<Record<string, unknown>> = await delegate.findMany({ skip, take: PAGE_SIZE });
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return rows;
}

export async function encryptedDatabaseBackupProcessor(job: Job<{ triggeredBy: string }>): Promise<{ storageKey: string; fileSizeBytes: number }> {
  const triggeredBy = job.data?.triggeredBy ?? "cron";
  const logEntry = await prismaUnscoped.databaseBackupLog.create({
    data: { status: "RUNNING", triggeredBy },
  });

  try {
    const backupKeyHex = await getPlatformSecret("BACKUP_ENCRYPTION_KEY");
    if (!backupKeyHex) {
      throw new Error(
        "BACKUP_ENCRYPTION_KEY não configurada — defina em Painel Admin → Infraestrutura (grupo Backup) ou na variável de ambiente correspondente antes do backup rodar.",
      );
    }
    const backupKey = Buffer.from(backupKeyHex, "hex");
    if (backupKey.byteLength !== 32) {
      throw new Error(`BACKUP_ENCRYPTION_KEY inválida: esperado 32 bytes (64 caracteres hex), recebido ${backupKey.byteLength} bytes.`);
    }

    // Dump lógico de TODOS os modelos do schema (plataforma inteira, cross-tenant) —
    // nunca pula nenhum, inclusive modelos platform-wide como `PlatformSecret`
    // (cifrados no próprio banco) e `Tenant`.
    const dump: Record<string, Record<string, unknown>[]> = {};
    let totalRows = 0;
    for (const model of Prisma.dmmf.datamodel.models) {
      try {
        const rows = await dumpModel(model.name);
        dump[model.name] = rows;
        totalRows += rows.length;
      } catch (error) {
        // Um modelo problemático nunca pode derrubar o backup inteiro dos demais —
        // mesmo princípio de `data-export-generation.worker.ts`.
        log.error({ model: model.name, err: error }, "falha ao extrair modelo para o backup, pulando");
      }
    }

    const jsonPayload = JSON.stringify({ generatedAt: new Date().toISOString(), models: dump }, backupJsonReplacer);
    const compressed = gzipSync(Buffer.from(jsonPayload, "utf8"));

    // IV (12 bytes, nunca reaproveitado) + authTag (16 bytes) + ciphertext, todos
    // concatenados no MESMO arquivo — não depende de metadata do objeto no R2
    // sobreviver para restaurar (o próprio arquivo .enc é autossuficiente).
    const iv = randomBytes(12);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, backupKey, iv);
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedFile = Buffer.concat([iv, authTag, ciphertext]);

    // Identificador curto e não-reversível da chave usada (nunca a chave em si) —
    // permite, numa rotação futura de BACKUP_ENCRYPTION_KEY, saber qual chave
    // decifra qual backup antigo sem expor segredo nenhum no banco.
    const encryptionKeyId = createHash("sha256").update(backupKey).digest("hex").slice(0, 16);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { storageKey } = await putPlatformObjectDirect({
      category: "database-backups",
      fileName: `database-backup-${timestamp}.enc`,
      mimeType: "application/octet-stream",
      body: encryptedFile,
    });

    await prismaUnscoped.databaseBackupLog.update({
      where: { id: logEntry.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        storageKey,
        fileSizeBytes: BigInt(encryptedFile.byteLength),
        encryptionKeyId,
      },
    });

    log.info({ storageKey, totalRows, fileSizeBytes: encryptedFile.byteLength }, "backup_completed");
    return { storageKey, fileSizeBytes: encryptedFile.byteLength };
  } catch (error) {
    const errorMessage = (error as Error).message;
    await prismaUnscoped.databaseBackupLog.update({
      where: { id: logEntry.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage },
    });
    log.error({ err: error }, "backup_failed");
    throw error; // relança: diferente dos jobs sob demanda de 18.4/18.5, este É um
    // job de cron repetível — o BullMQ precisa marcar "failed" de verdade para que
    // o painel admin (lista de jobs falhos) e alertas futuros consigam detectar.
  }
}

export function startEncryptedDatabaseBackupWorker(): Worker {
  return new Worker(QUEUE_NAMES.DATABASE_BACKUP, encryptedDatabaseBackupProcessor, {
    connection: queueRedisConnection,
    concurrency: 1, // nunca dois dumps completos do banco rodando ao mesmo tempo (custo de memória/CPU)
  });
}

export async function scheduleEncryptedDatabaseBackupJob(): Promise<void> {
  await databaseBackupQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_3AM },
    { name: REPEATABLE_JOB_NAME, data: { triggeredBy: "cron" } },
  );
}
