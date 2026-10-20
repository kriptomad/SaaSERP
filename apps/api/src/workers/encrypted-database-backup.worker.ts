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
import { createCipheriv, createDecipheriv, randomBytes, createHash, type CipherGCM } from "node:crypto";
import { createGzip, gunzipSync } from "node:zlib";
import { Readable, Transform } from "node:stream";
import { Prisma, prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, databaseBackupQueue, HEAVY_RECURRING_JOB_OPTS } from "../lib/queue";
import { putPlatformObjectStream, getObjectDirect } from "../lib/object-storage";
import { getPlatformSecret } from "../lib/platform-secrets";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("encrypted-database-backup.worker");

const REPEATABLE_JOB_NAME = "daily-backup";
const DAILY_CRON_3AM = "0 3 * * *";
const PAGE_SIZE = 2000;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
// fa-w6-di-backup-not-pit-consistent — todo o dump (leitura de TODOS os modelos) e o
// upload do arquivo resultante rodam dentro de UMA ÚNICA transação interativa do
// Prisma em `REPEATABLE READ`: garante que cada modelo seja lido do MESMO snapshot
// do banco, do primeiro ao último registro, em vez de N transações implícitas
// independentes (uma por `findMany` de página) que podiam ver um estado diferente do
// banco a cada página — uma venda concluída/cancelada no meio do dump podia, por
// exemplo, aparecer em `Sale` mas não (ainda) no `SaleItem` relacionado, ou
// vice-versa. `Serializable` seria ainda mais rígido, mas para uma leitura
// long-running de TODAS as tabelas (nunca escreve nada) `REPEATABLE READ` já entrega
// a mesma garantia de consistência de leitura sem o custo adicional de detecção de
// conflito de serialização do Postgres. `BACKUP_TRANSACTION_TIMEOUT_MS` generoso
// porque a transação fica aberta durante TODO o upload (não só a leitura) — trade-off
// consciente: `concurrency: 1` (ver `startEncryptedDatabaseBackupWorker` abaixo)
// garante que este worker nunca segura mais de UMA conexão do pool por vez.
const BACKUP_TRANSACTION_TIMEOUT_MS = 30 * 60 * 1000;
const BACKUP_TRANSACTION_MAX_WAIT_MS = 10_000;
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
 *
 * fa-w6-di-backup-not-pit-consistent — recebe `tx` (o client interativo da transação
 * `REPEATABLE READ` aberta pelo chamador) em vez de `prismaUnscoped` diretamente:
 * TODA leitura deste gerador enxerga o mesmo snapshot do banco. Um erro de leitura em
 * QUALQUER modelo agora SEMPRE propaga (nunca é engolido) — um modelo que falha
 * pela metade deixaria o backup com um buraco silencioso, inútil para restauração
 * point-in-time; é preferível todo o backup do dia falhar explicitamente (status
 * FAILED, alertável) do que existir um backup "SUCCESS" incompleto.
 */
async function* dumpAllModelsAsNdjson(
  tx: Prisma.TransactionClient,
  stats: { totalRows: number; generatedAt: string; perModelRowCounts: Record<string, number> },
): AsyncGenerator<Buffer> {
  yield Buffer.from(JSON.stringify({ __meta: true, generatedAt: stats.generatedAt }) + "\n", "utf8");

  for (const model of Prisma.dmmf.datamodel.models) {
    const delegateName = toLowerCamelDelegateName(model.name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (tx as any)[delegateName];
    if (!delegate || typeof delegate.findMany !== "function") continue;

    let modelRowCount = 0;
    let skip = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page: Array<Record<string, unknown>> = await delegate.findMany({ skip, take: PAGE_SIZE });
      for (const row of page) {
        yield Buffer.from(JSON.stringify({ __model: model.name, row }, backupJsonReplacer) + "\n", "utf8");
        stats.totalRows += 1;
        modelRowCount += 1;
      }
      if (page.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }
    stats.perModelRowCounts[model.name] = modelRowCount;
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

/**
 * fa-w6-di-backup-no-restore-verification — depois do upload, rebaixa o próprio
 * arquivo `.enc` recém-gravado do R2, decifra (AES-256-GCM — `decipher.final()`
 * lança se o `authTag` não bater, pegando qualquer corrupção de upload/cifra) e
 * reconta as linhas NDJSON por modelo, comparando com o que foi efetivamente lido
 * do banco (`expected`). Um backup cujo arquivo final não reproduz exatamente o que
 * foi gravado NUNCA deve ser marcado SUCCESS — por isso esta função lança em vez de
 * só logar, e o chamador (`encryptedDatabaseBackupProcessor`) NÃO atualiza o
 * `DatabaseBackupLog` para SUCCESS antes dela retornar sem erro.
 *
 * Escopo deliberadamente conservador: isto confirma que "o que está no R2 decifra e
 * bate com o que foi lido", não que "o esquema restaura de fato em um Postgres
 * vazio" — essa segunda garantia (um restore-drill completo, idealmente periódico e
 * automatizado contra um banco de staging efêmero) requer infraestrutura de banco
 * que este ambiente de trabalho não tem disponível para validar com segurança.
 * RUNBOOK MANUAL (até que o restore-drill automatizado exista): a cada trimestre, um
 * operador deve rodar `apps/api/scripts/restore-encrypted-backup.mjs` contra um
 * Postgres de staging descartável com o backup mais recente e confirmar que a
 * contagem de linhas por tabela bate com o `modelRowCounts` do `DatabaseBackupLog`
 * correspondente — isto NÃO é verificado automaticamente por este worker.
 *
 * Baixa o objeto inteiro em memória (`getObjectDirect`) em vez de stream — exceção
 * deliberada à política "nunca materializar o backup inteiro em memória" do resto
 * deste arquivo: aqui o arquivo já está comprimido+cifrado (bem menor que o dump
 * bruto), a verificação roda só 1x/dia, e `concurrency: 1` garante que nunca há dois
 * backups (upload OU verificação) competindo por memória ao mesmo tempo.
 */
async function verifyUploadedBackupIntegrity(params: {
  storageKey: string;
  backupKey: Buffer;
  expectedTotalRows: number;
  expectedPerModelRowCounts: Record<string, number>;
}): Promise<void> {
  const { storageKey, backupKey, expectedTotalRows, expectedPerModelRowCounts } = params;

  const encrypted = await getObjectDirect(storageKey);
  if (!encrypted.subarray(0, 4).equals(STREAMING_FORMAT_MAGIC)) {
    throw new Error(`Verificação pós-backup falhou: arquivo "${storageKey}" não tem o cabeçalho mágico esperado (FBK2).`);
  }
  const fileIv = encrypted.subarray(4, 16);
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(16, encrypted.length - 16);

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, backupKey, fileIv);
  decipher.setAuthTag(authTag);
  // `decipher.final()` lança `Error: Unsupported state or unable to authenticate
  // data` se o `authTag` não bater com o ciphertext — é a própria verificação
  // criptográfica de integridade do GCM, nunca precisa ser reimplementada à mão.
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const decompressed = gunzipSync(compressed).toString("utf8");

  let actualTotalRows = 0;
  const actualPerModelRowCounts: Record<string, number> = {};
  for (const line of decompressed.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as { __meta?: boolean; __model?: string };
    if (!parsed.__model) continue;
    actualTotalRows += 1;
    actualPerModelRowCounts[parsed.__model] = (actualPerModelRowCounts[parsed.__model] ?? 0) + 1;
  }

  if (actualTotalRows !== expectedTotalRows) {
    throw new Error(
      `Verificação pós-backup falhou: esperado ${expectedTotalRows} linhas no total, encontrado ${actualTotalRows} após decifrar/decomprimir "${storageKey}".`,
    );
  }
  for (const [model, expectedCount] of Object.entries(expectedPerModelRowCounts)) {
    const actualCount = actualPerModelRowCounts[model] ?? 0;
    if (actualCount !== expectedCount) {
      throw new Error(
        `Verificação pós-backup falhou: modelo "${model}" esperava ${expectedCount} linhas, encontrado ${actualCount} em "${storageKey}".`,
      );
    }
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

    const stats = { totalRows: 0, generatedAt: new Date().toISOString(), perModelRowCounts: {} as Record<string, number> };
    const iv = randomBytes(12);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // fa-w6-di-backup-not-pit-consistent — leitura de TODOS os modelos + upload do
    // arquivo final rodam dentro de UMA transação `REPEATABLE READ` (ver comentário
    // de `BACKUP_TRANSACTION_TIMEOUT_MS` acima): qualquer erro em QUALQUER estágio
    // (leitura de um modelo, gzip, cifra, upload) propaga e `$transaction` relança
    // — o `catch` externo marca o `DatabaseBackupLog` como FAILED, nunca SUCCESS
    // parcial.
    const { storageKey, fileSizeBytes } = await prismaUnscoped.$transaction(
      async (tx) => {
        // Pipeline 100% em stream: dump paginado (NDJSON) -> gzip -> cifra
        // AES-256-GCM -> upload multipart direto ao R2 — em nenhum ponto o dump
        // completo, comprimido ou cifrado existe inteiro em um único Buffer na
        // memória do processo (ao contrário da versão anterior: `JSON.stringify` do
        // banco inteiro + `gzipSync` + `Buffer.concat` do ciphertext inteiro, todos
        // simultâneos antes do upload).
        const ndjsonStream = Readable.from(dumpAllModelsAsNdjson(tx, stats));
        const gzipStream = ndjsonStream.pipe(createGzip());
        const encryptStream = gzipStream.pipe(new EncryptAndFrameTransform(backupKey, iv));
        // `.pipe()` não propaga erro de origem para o destino — garante que um erro
        // em qualquer estágio anterior derruba o stream final (consumido pelo
        // upload) em vez de deixá-lo pendurado esperando dados que nunca chegarão.
        ndjsonStream.on("error", (err) => encryptStream.destroy(err));
        gzipStream.on("error", (err) => encryptStream.destroy(err));

        return putPlatformObjectStream({
          category: "database-backups",
          fileName: `database-backup-${timestamp}.enc`,
          mimeType: "application/octet-stream",
          body: encryptStream,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: BACKUP_TRANSACTION_TIMEOUT_MS, maxWait: BACKUP_TRANSACTION_MAX_WAIT_MS },
    );

    // Identificador curto e não-reversível da chave usada (nunca a chave em si) —
    // permite, numa rotação futura de BACKUP_ENCRYPTION_KEY, saber qual chave
    // decifra qual backup antigo sem expor segredo nenhum no banco.
    const encryptionKeyId = createHash("sha256").update(backupKey).digest("hex").slice(0, 16);

    // fa-w6-di-backup-no-restore-verification — só marca SUCCESS depois de confirmar
    // que o arquivo gravado no R2 decifra e reproduz exatamente as contagens lidas
    // do banco. Se isto lançar, cai no `catch` externo (status FAILED) — nunca existe
    // um `DatabaseBackupLog` SUCCESS cujo arquivo final não foi verificado.
    await verifyUploadedBackupIntegrity({
      storageKey,
      backupKey,
      expectedTotalRows: stats.totalRows,
      expectedPerModelRowCounts: stats.perModelRowCounts,
    });

    await prismaUnscoped.databaseBackupLog.update({
      where: { id: logEntry.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        storageKey,
        fileSizeBytes: BigInt(fileSizeBytes),
        encryptionKeyId,
        modelRowCounts: stats.perModelRowCounts,
        verifiedAt: new Date(),
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
