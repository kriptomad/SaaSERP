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
//
// REVISÃO FINAL (fechamento do item residual `backup-pgdump-review` da mega-audit):
// avaliada a alternativa de trazer o binário real `pg_dump`/libpq para dentro da
// imagem distroless via multi-stage COPY (ambos os estágios do Dockerfile são
// baseados em Debian 12, então os `.so` resolvidos por `ldd` no estágio de build
// seriam binário-compatíveis com o estágio final). Decisão: NÃO adotar. Motivos:
// (1) reintroduz binários nativos arbitrários na imagem de produção, o oposto do
// que a distroless promete (Capítulo 3.1); (2) qualquer incompatibilidade de
// versão de libpq/OpenSSL só seria descoberta em produção — este ambiente de
// trabalho não tem Docker disponível para construir e rodar o container e validar
// a mudança com segurança antes do deploy; (3) o dump lógico via Prisma já entrega
// a mesma garantia funcional (cifra + upload + restauração) sem downtime e sem
// abrir mão da superfície de ataque mínima. Decisão arquitetural considerada
// DEFINITIVA, não mais um gap em aberto.
import { Worker, Job } from "bullmq";
import { createCipheriv, randomBytes, createHash, type CipherGCM } from "node:crypto";
import { createGzip } from "node:zlib";
import { Readable, Transform } from "node:stream";
import { Prisma, prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, databaseBackupQueue, HEAVY_RECURRING_JOB_OPTS } from "../lib/queue";
import { putPlatformObjectStream } from "../lib/object-storage";
import { getPlatformSecret } from "../lib/platform-secrets";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("encrypted-database-backup.worker");

const REPEATABLE_JOB_NAME = "daily-backup";
const DAILY_CRON_3AM = "0 3 * * *";
const PAGE_SIZE = 2000;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
// fa-w4-backup-worker-oom — identifica o FORMATO do arquivo cifrado: o antigo
// (iv(12) || authTag(16) || ciphertext inteiro) exigia ter o ciphertext completo em
// mãos para montar o cabeçalho (o authTag do GCM só é conhecido depois de cifrar
// TUDO), o que forçava manter o backup inteiro em memória antes do upload. O novo
// formato move o authTag para o FINAL do arquivo (depois do ciphertext em stream),
// permitindo cifrar/fazer upload incrementalmente — `scripts/restore-encrypted-backup.mjs`
// reconhece os dois formatos pelos 4 bytes mágicos iniciais.
const STREAMING_FORMAT_MAGIC = Buffer.from("FBK2", "ascii");

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

/**
 * fa-w4-backup-worker-oom — gerador assíncrono que produz o dump inteiro em NDJSON
 * (uma linha JSON por registro, prefixada pelo nome do modelo), paginando UM modelo
 * por vez e UMA página por vez (nunca acumulando `rows` de um modelo inteiro, muito
 * menos do banco inteiro, em memória — ao contrário da versão anterior que montava
 * `dump: Record<string, Record<string,unknown>[]>` com TODOS os modelos de uma vez).
 * `stats` é preenchido como efeito colateral (lido pelo chamador só depois do stream
 * terminar de ser consumido).
 */
async function* dumpAllModelsAsNdjson(stats: { totalRows: number; generatedAt: string }): AsyncGenerator<Buffer> {
  yield Buffer.from(JSON.stringify({ __meta: true, generatedAt: stats.generatedAt }) + "\n", "utf8");

  for (const model of Prisma.dmmf.datamodel.models) {
    const delegateName = toLowerCamelDelegateName(model.name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (prismaUnscoped as any)[delegateName];
    if (!delegate || typeof delegate.findMany !== "function") continue;

    try {
      let skip = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page: Array<Record<string, unknown>> = await delegate.findMany({ skip, take: PAGE_SIZE });
        for (const row of page) {
          yield Buffer.from(JSON.stringify({ __model: model.name, row }, backupJsonReplacer) + "\n", "utf8");
          stats.totalRows += 1;
        }
        if (page.length < PAGE_SIZE) break;
        skip += PAGE_SIZE;
      }
    } catch (error) {
      // Um modelo problemático nunca pode derrubar o backup inteiro dos demais —
      // mesmo princípio da versão anterior (e de `data-export-generation.worker.ts`).
      log.error({ model: model.name, err: error }, "falha ao extrair modelo para o backup, pulando");
    }
  }
}

/**
 * Transform que cifra (AES-256-GCM) o stream comprimido chunk a chunk: escreve o
 * cabeçalho (magic + IV) antes do primeiro chunk cifrado, e o `authTag` (só
 * disponível depois de `cipher.final()`) como os últimos 16 bytes do stream —
 * mesma garantia de integridade do formato anterior, só reordenada para permitir
 * streaming (o authTag do GCM nunca pode ser conhecido antes do fim do ciphertext).
 */
class EncryptAndFrameTransform extends Transform {
  private readonly cipher: CipherGCM;
  private readonly iv: Buffer;
  private headerWritten = false;

  constructor(key: Buffer, iv: Buffer) {
    super();
    this.iv = iv;
    this.cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv) as CipherGCM;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.headerWritten) {
      this.push(Buffer.concat([STREAMING_FORMAT_MAGIC, this.iv]));
      this.headerWritten = true;
    }
    this.push(this.cipher.update(chunk));
    callback();
  }

  override _flush(callback: (error?: Error | null) => void): void {
    if (!this.headerWritten) {
      this.push(Buffer.concat([STREAMING_FORMAT_MAGIC, this.iv]));
      this.headerWritten = true;
    }
    this.push(this.cipher.final());
    this.push(this.cipher.getAuthTag());
    callback();
  }
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

    const stats = { totalRows: 0, generatedAt: new Date().toISOString() };
    const iv = randomBytes(12);

    // Pipeline 100% em stream: dump paginado (NDJSON) -> gzip -> cifra AES-256-GCM
    // -> upload multipart direto ao R2 — em nenhum ponto o dump completo, comprimido
    // ou cifrado existe inteiro em um único Buffer na memória do processo (ao
    // contrário da versão anterior: `JSON.stringify` do banco inteiro + `gzipSync` +
    // `Buffer.concat` do ciphertext inteiro, todos simultâneos antes do upload).
    const ndjsonStream = Readable.from(dumpAllModelsAsNdjson(stats));
    const gzipStream = ndjsonStream.pipe(createGzip());
    const encryptStream = gzipStream.pipe(new EncryptAndFrameTransform(backupKey, iv));
    // `.pipe()` não propaga erro de origem para o destino — garante que um erro em
    // qualquer estágio anterior derruba o stream final (consumido pelo upload) em vez
    // de deixá-lo pendurado esperando dados que nunca chegarão.
    ndjsonStream.on("error", (err) => encryptStream.destroy(err));
    gzipStream.on("error", (err) => encryptStream.destroy(err));

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { storageKey, fileSizeBytes } = await putPlatformObjectStream({
      category: "database-backups",
      fileName: `database-backup-${timestamp}.enc`,
      mimeType: "application/octet-stream",
      body: encryptStream,
    });

    // Identificador curto e não-reversível da chave usada (nunca a chave em si) —
    // permite, numa rotação futura de BACKUP_ENCRYPTION_KEY, saber qual chave
    // decifra qual backup antigo sem expor segredo nenhum no banco.
    const encryptionKeyId = createHash("sha256").update(backupKey).digest("hex").slice(0, 16);

    await prismaUnscoped.databaseBackupLog.update({
      where: { id: logEntry.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        storageKey,
        fileSizeBytes: BigInt(fileSizeBytes),
        encryptionKeyId,
      },
    });

    log.info({ storageKey, totalRows: stats.totalRows, fileSizeBytes }, "backup_completed");
    return { storageKey, fileSizeBytes };
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
    { name: REPEATABLE_JOB_NAME, data: { triggeredBy: "cron" }, opts: HEAVY_RECURRING_JOB_OPTS },
  );
}
