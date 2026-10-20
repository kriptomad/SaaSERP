// apps/api/src/lib/object-storage.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3 — Cloudflare R2 (API S3-compatible, zero
// egress fees) para avatares, fotos de equipamento/avaria (OsPhoto) e XMLs fiscais.
//
// GAP DE AUDITORIA FECHADO: até esta rodada não existia NENHUMA integração real com R2
// — `storage-key.ts` só validava o formato da chave, e o frontend de O.S. tinha um
// campo de TEXTO LIVRE para o usuário digitar manualmente o "storageKey" (nunca fazia
// upload de arquivo nenhum). Este módulo é o cliente S3 real (Cloudflare R2 é
// S3-compatible) usado para emitir URLs assinadas de upload/download, nunca para
// proxyar o binário pela própria API (evita duplicar o tráfego de rede/memória).
//
// Convenção de bucket único (Capítulo 3): um único bucket de plataforma, isolamento
// lógico 100% via prefixo de chave `tenants/<tenantId>/<categoria>/<arquivo>` — nunca
// um bucket por tenant (inviável operacionalmente em escala).
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { getPlatformSecret } from "./platform-secrets";
import { isTenantStorageKey } from "./storage-key";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("object-storage");

const PRESIGNED_UPLOAD_EXPIRES_SECONDS = 5 * 60; // 5 min — suficiente para o upload direto do navegador, curto o bastante para não deixar a URL viva por muito tempo.
const PRESIGNED_DOWNLOAD_EXPIRES_SECONDS = 15 * 60; // 15 min — tempo de visualizar/baixar uma foto/XML no painel.
// GAP DE AUDITORIA FECHADO: categorias `publicReadable` (hoje só `avatars`) usavam a
// URL pública do Custom Domain (`R2_PUBLIC_BASE_URL`) SEM NENHUMA assinatura/expiração
// — uma vez vazada (log, cache de proxy, extensão de navegador), a URL continuava
// servindo a imagem PARA SEMPRE, sem nenhuma forma de revogação. Substituído por uma
// URL assinada de leitura com expiração de 7 dias: como o chamador real
// (`public-online-store.routes.ts`, logo da vitrine) já gera este link do zero a cada
// carregamento de página (nunca persiste/cacheia o valor da URL em banco), um link
// mais longo mas EXPIRÁVEL funciona de forma idêntica para quem exibe a imagem —
// nenhuma funcionalidade de exibição quebra. O único efeito colateral aceito
// conscientemente é a perda de cacheabilidade de CDN/edge POR URL IDÊNTICA entre
// visitantes diferentes (cada presign gera uma assinatura única), já que a allowlist
// de mimetype/extensão + o isolamento por tenant continuam sendo a defesa primária;
// a "renovação" citada na auditoria é automática — a cada nova chamada a
// `presignObjectDownload` (cada carregamento de página) gera-se uma nova URL válida
// por mais 7 dias, nunca reaproveitando uma já emitida.
const PRESIGNED_PUBLIC_ASSET_EXPIRES_SECONDS = 7 * 24 * 60 * 60;

/** Categorias de objeto permitidas (Capítulo 3) — grava a allowlist de extensão/mimetype por categoria para nunca aceitar upload arbitrário.
 * `publicReadable` controla se `presignObjectDownload` pode servir esta categoria via
 * `R2_PUBLIC_BASE_URL` (Custom Domain, sem assinatura/expiração) quando configurado —
 * GAP DE AUDITORIA FECHADO (Rodada 6): antes QUALQUER categoria virava uma URL pública
 * eterna e sem assinatura assim que o admin de plataforma configurava
 * `R2_PUBLIC_BASE_URL` (feito para servir o logo da vitrine virtual sem gastar uma
 * assinatura por visita), vazando acesso permanente e anônimo a XMLs fiscais, laudos
 * de O.S. com fotos de cliente, documentos do escritório contábil e ZIPs completos de
 * exportação de dados para qualquer um que obtivesse a URL (ela nunca expira e é
 * cacheável por CDN/motores de busca). Só `avatars` (fotos de perfil/logo de loja —
 * já pensadas para exibição pública, baixa sensibilidade) pode pular a assinatura.
 */
export const STORAGE_CATEGORIES = {
  "work-order-photos": { allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 15 * 1024 * 1024, publicReadable: false },
  avatars: { allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024, publicReadable: true },
  "fiscal-xml": { allowedMimeTypes: ["text/xml", "application/xml"], maxBytes: 2 * 1024 * 1024, publicReadable: false },
  "client-record-photos": { allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 15 * 1024 * 1024, publicReadable: false },
  "official-tax-documents": { allowedMimeTypes: ["text/plain", "application/xml"], maxBytes: 20 * 1024 * 1024, publicReadable: false },
  // Capítulo 18.4 — ZIP final gerado por `data-export-generation.worker.ts`, upload
  // direto pelo backend (putObjectDirect), nunca pelo navegador.
  "data-export": { allowedMimeTypes: ["application/zip"], maxBytes: 500 * 1024 * 1024, publicReadable: false },
  // Capítulo 18.5 — arquivo original (CSV/XLSX) enviado pelo lojista no wizard de
  // importação assistida, via presignObjectUpload (upload direto do navegador).
  "data-import-source": {
    allowedMimeTypes: ["text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    maxBytes: 20 * 1024 * 1024,
    publicReadable: false,
  },
  // Capítulo 18.5 — relatório de erros por linha (CSV) gerado pela etapa de
  // validação, upload direto pelo backend.
  "data-import-reports": { allowedMimeTypes: ["text/csv"], maxBytes: 10 * 1024 * 1024, publicReadable: false },
  // Capítulo 10.3 — dump completo do banco, já cifrado em AES-256-GCM antes do
  // upload (o arquivo em si é binário opaco — ".enc" não é um mimetype IANA real,
  // mas identifica inequivocamente "já cifrado" para quem navegar o bucket).
  "database-backups": { allowedMimeTypes: ["application/octet-stream"], maxBytes: 5 * 1024 * 1024 * 1024, publicReadable: false },
  // Capítulo 15.3 — anexos (foto/print) de chamados de helpdesk, enviados pelo
  // lojista junto do relato do problema ou de uma resposta — mesmo padrão de upload
  // direto do navegador usado em work-order-photos/client-record-photos.
  "support-ticket-attachments": { allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 10 * 1024 * 1024, publicReadable: false },
  // fa-perf-report-export-inline — PDF/XLSX gerado sob demanda por
  // `workers/report-export-generation.worker.ts` a partir de um `ReportDefinition`,
  // upload direto pelo backend (mesmo padrão de "official-tax-documents").
  "report-exports": {
    allowedMimeTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    maxBytes: 25 * 1024 * 1024,
    publicReadable: false,
  },
} as const;
export type StorageCategory = keyof typeof STORAGE_CATEGORIES;

/** Extrai a categoria do padrão `tenants/<tenantId>/<categoria>/<arquivo>` — nunca
 * confia em nada enviado pelo chamador, sempre reconstrói a partir da própria chave
 * persistida, que é a fonte de verdade de qual categoria aquele objeto pertence. */
function categoryOfStorageKey(storageKey: string): StorageCategory | null {
  const parts = storageKey.split("/");
  const candidate = parts[2];
  return candidate && candidate in STORAGE_CATEGORIES ? (candidate as StorageCategory) : null;
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string | null;
}

async function loadR2Config(): Promise<R2Config> {
  const [accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl] = await Promise.all([
    getPlatformSecret("R2_ACCOUNT_ID"),
    getPlatformSecret("R2_ACCESS_KEY_ID"),
    getPlatformSecret("R2_SECRET_ACCESS_KEY"),
    getPlatformSecret("R2_BUCKET_NAME"),
    getPlatformSecret("R2_PUBLIC_BASE_URL"),
  ]);
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Cloudflare R2 não configurado — defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET_NAME em Painel Admin → Infraestrutura (grupo Armazenamento (R2)) ou nas variáveis de ambiente correspondentes.",
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl: publicBaseUrl || null };
}

// Cache de cliente em memória, igual ao padrão já usado em stripe.client.ts — invalida
// automaticamente quando qualquer uma das 4 credenciais muda via painel admin.
let cachedClient: S3Client | null = null;
let cachedFingerprint: string | null = null;

async function getR2Client(): Promise<{ client: S3Client; config: R2Config }> {
  const config = await loadR2Config();
  const fingerprint = `${config.accountId}:${config.accessKeyId}:${config.bucket}`;
  if (cachedClient && cachedFingerprint === fingerprint) {
    return { client: cachedClient, config };
  }
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  cachedFingerprint = fingerprint;
  return { client: cachedClient, config };
}

function sanitizeFileName(fileName: string): string {
  // Mantém apenas caracteres seguros para chave de objeto — nunca repassa o nome do
  // arquivo do usuário sem sanitização (poderia conter `../`, espaços, acentos, etc.).
  const base = fileName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return safe.slice(-120) || "arquivo";
}

// GAP DE AUDITORIA FECHADO: `presignObjectUpload` só validava o MIME type declarado
// pelo cliente contra a allowlist da categoria, mas nunca conferia se a EXTENSÃO do
// nome do arquivo era condizente — um upload malicioso podia declarar
// `mimeType: "image/jpeg"` (passando pela allowlist) enquanto o nome real do arquivo
// era `malware.html`/`shell.php`, que muitos navegadores/proxies/visualizadores de
// terceiros inferem pela EXTENSÃO, não pelo `Content-Type` assinado no PUT (que o R2
// só valida contra o header enviado, nunca contra o conteúdo real do arquivo).
// Mapeamento deliberadamente estrito: cada MIME type permitido por alguma categoria
// de `STORAGE_CATEGORIES` lista as únicas extensões aceitas para ele.
const MIME_TYPE_ALLOWED_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "text/xml": [".xml"],
  "application/xml": [".xml"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/zip": [".zip"],
  "application/pdf": [".pdf"],
  // Binário opaco já cifrado (dump de banco, Capítulo 10.3) — sem extensão IANA real,
  // mas ainda assim restrito a um conjunto fechado de sufixos esperados.
  "application/octet-stream": [".enc", ".bin"],
};

function assertExtensionMatchesMimeType(fileName: string, mimeType: string): void {
  const allowedExtensions = MIME_TYPE_ALLOWED_EXTENSIONS[mimeType];
  if (!allowedExtensions) {
    // Mimetype não mapeado aqui não deveria nem ter passado pela allowlist de
    // categoria (fail-closed): trata como inconsistência para nunca aceitar por
    // omissão um tipo que esquecemos de mapear.
    throw new Error(`Tipo de arquivo "${mimeType}" não possui extensão(ões) permitida(s) mapeada(s).`);
  }
  const lowerFileName = fileName.toLowerCase();
  const matches = allowedExtensions.some((ext) => lowerFileName.endsWith(ext));
  if (!matches) {
    throw new Error(
      `Extensão do arquivo "${fileName}" não é condizente com o tipo declarado "${mimeType}" (esperado: ${allowedExtensions.join(", ")}).`,
    );
  }
}

export interface PresignUploadInput {
  tenantId: string;
  category: StorageCategory;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface PresignUploadResult {
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

/**
 * Gera a chave de objeto (sempre `tenants/<tenantId>/<categoria>/<uuid>-<nome>`) e a
 * URL assinada de PUT direto no R2. A API nunca recebe o binário — o navegador faz o
 * upload diretamente para a URL assinada (Capítulo 3), evitando que o arquivo passe
 * duas vezes pela rede/memória do processo Node.
 */
export async function presignObjectUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
  const categoryDef = STORAGE_CATEGORIES[input.category];
  if (!categoryDef) {
    throw new Error(`Categoria de armazenamento desconhecida: ${input.category}.`);
  }
  if (!categoryDef.allowedMimeTypes.includes(input.mimeType as never)) {
    throw new Error(`Tipo de arquivo não permitido para "${input.category}": ${input.mimeType}. Permitidos: ${categoryDef.allowedMimeTypes.join(", ")}.`);
  }
  assertExtensionMatchesMimeType(input.fileName, input.mimeType);
  if (input.fileSizeBytes <= 0 || input.fileSizeBytes > categoryDef.maxBytes) {
    throw new Error(`Tamanho de arquivo inválido para "${input.category}": ${input.fileSizeBytes} bytes (máximo: ${categoryDef.maxBytes} bytes).`);
  }

  const { client, config } = await getR2Client();
  const storageKey = `tenants/${input.tenantId}/${input.category}/${crypto.randomUUID()}-${sanitizeFileName(input.fileName)}`;

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: storageKey,
    ContentType: input.mimeType,
    ContentLength: input.fileSizeBytes,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: PRESIGNED_UPLOAD_EXPIRES_SECONDS });

  return { uploadUrl, storageKey, expiresInSeconds: PRESIGNED_UPLOAD_EXPIRES_SECONDS };
}

/**
 * URL assinada de LEITURA para um `storageKey` já existente — reaplica a mesma
 * validação de prefixo de `isTenantStorageKey` usada nas rotas que persistem o
 * ponteiro, fechando o mesmo vetor (tenant A não pode ler objeto de tenant B mesmo
 * sabendo a chave exata, porque a chave de outro tenant nunca passa nesta checagem).
 */
export async function presignObjectDownload(tenantId: string, storageKey: string): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  if (!isTenantStorageKey(storageKey, tenantId)) {
    throw new Error("A chave de armazenamento não pertence ao tenant autenticado.");
  }
  const { client, config } = await getR2Client();

  const category = categoryOfStorageKey(storageKey);
  if (category && STORAGE_CATEGORIES[category].publicReadable) {
    // Ver nota em `PRESIGNED_PUBLIC_ASSET_EXPIRES_SECONDS` acima — substituída a URL
    // pública eterna/sem assinatura do Custom Domain (`R2_PUBLIC_BASE_URL`) por uma
    // URL assinada de leitura com expiração de 7 dias, renovada automaticamente a
    // cada nova chamada desta função (ex.: cada carregamento da página da vitrine
    // virtual gera uma URL nova). `R2_PUBLIC_BASE_URL` deixa de ser usado para
    // construir a URL de avatar — mantido na config só para eventual uso futuro de
    // outras finalidades de CDN, nunca mais para servir leitura sem assinatura.
    const command = new GetObjectCommand({ Bucket: config.bucket, Key: storageKey });
    const downloadUrl = await getSignedUrl(client, command, { expiresIn: PRESIGNED_PUBLIC_ASSET_EXPIRES_SECONDS });
    return { downloadUrl, expiresInSeconds: PRESIGNED_PUBLIC_ASSET_EXPIRES_SECONDS };
  }

  const command = new GetObjectCommand({ Bucket: config.bucket, Key: storageKey });
  const downloadUrl = await getSignedUrl(client, command, { expiresIn: PRESIGNED_DOWNLOAD_EXPIRES_SECONDS });
  return { downloadUrl, expiresInSeconds: PRESIGNED_DOWNLOAD_EXPIRES_SECONDS };
}

export interface PutObjectDirectInput {
  tenantId: string;
  category: StorageCategory;
  fileName: string;
  mimeType: string;
  body: string | Buffer;
}

/**
 * Upload DIRETO pelo backend (sem presigned URL) — usado para arquivos que o
 * próprio servidor gera (ex.: SPED ECD/DEFIS, Capítulo 21.18.5), nunca enviados
 * pelo navegador. Diferente de `presignObjectUpload`, aqui o binário/texto passa
 * pela memória do processo Node uma única vez (arquivos de declaração fiscal são
 * tipicamente pequenos — KB a poucos MB — o custo é aceitável).
 */
export async function putObjectDirect(input: PutObjectDirectInput): Promise<{ storageKey: string }> {
  const categoryDef = STORAGE_CATEGORIES[input.category];
  if (!categoryDef.allowedMimeTypes.includes(input.mimeType as never)) {
    throw new Error(`Tipo de arquivo não permitido para "${input.category}": ${input.mimeType}.`);
  }
  const { client, config } = await getR2Client();
  const storageKey = `tenants/${input.tenantId}/${input.category}/${crypto.randomUUID()}-${sanitizeFileName(input.fileName)}`;
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: storageKey,
      Body: input.body,
      ContentType: input.mimeType,
    }),
  );
  return { storageKey };
}

export interface PutPlatformObjectDirectInput {
  category: Extract<StorageCategory, "database-backups">;
  fileName: string;
  mimeType: string;
  body: Buffer;
}

/**
 * Upload DIRETO de um artefato de PLATAFORMA (não pertence a nenhum tenant
 * específico — ex.: o dump completo do banco, Capítulo 10.3). Usa o prefixo
 * `platform/<categoria>/...` em vez de `tenants/<tenantId>/...`, e por isso nunca
 * passa pela checagem `isTenantStorageKey` usada nos demais helpers — só rotas
 * `requireSuperAdmin` do painel admin devem chamar/servir este tipo de objeto.
 */
export async function putPlatformObjectDirect(input: PutPlatformObjectDirectInput): Promise<{ storageKey: string }> {
  const categoryDef = STORAGE_CATEGORIES[input.category];
  if (!categoryDef.allowedMimeTypes.includes(input.mimeType as never)) {
    throw new Error(`Tipo de arquivo não permitido para "${input.category}": ${input.mimeType}.`);
  }
  if (input.body.byteLength > categoryDef.maxBytes) {
    throw new Error(`Arquivo de ${input.body.byteLength} bytes excede o máximo de ${categoryDef.maxBytes} bytes para "${input.category}".`);
  }
  const { client, config } = await getR2Client();
  const storageKey = `platform/${input.category}/${crypto.randomUUID()}-${sanitizeFileName(input.fileName)}`;
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: storageKey,
      Body: input.body,
      ContentType: input.mimeType,
    }),
  );
  return { storageKey };
}

/** URL assinada de LEITURA para um objeto de plataforma (ex.: baixar um backup específico no painel admin) — sem checagem de tenant, restrito a rotas `requireSuperAdmin`. */
export async function presignPlatformObjectDownload(storageKey: string): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  if (!storageKey.startsWith("platform/")) {
    throw new Error("Chave de armazenamento inválida para objeto de plataforma.");
  }
  const { client, config } = await getR2Client();
  const command = new GetObjectCommand({ Bucket: config.bucket, Key: storageKey });
  const downloadUrl = await getSignedUrl(client, command, { expiresIn: PRESIGNED_DOWNLOAD_EXPIRES_SECONDS });
  return { downloadUrl, expiresInSeconds: PRESIGNED_DOWNLOAD_EXPIRES_SECONDS };
}

/** Teste de conexão real usado por `test-integration-credential.ts` (HeadBucket — não lista nem baixa nada, só confirma credencial + bucket). */
export async function testR2Connection(): Promise<{ success: boolean; message: string }> {
  try {
    const { client, config } = await getR2Client();
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return { success: true, message: `Conexão com o bucket R2 "${config.bucket}" confirmada (HeadBucket OK).` };
  } catch (error) {
    return { success: false, message: `Falha ao conectar ao bucket R2: ${(error as Error).message}` };
  }
}

/**
 * Download DIRETO pelo backend (sem presigned URL) — usado quando o próprio
 * servidor precisa ler o binário para processá-lo (ex.: `exceljs` parseando o
 * CSV/XLSX de importação, Capítulo 18.5; ou empacotar XMLs/fotos no ZIP de
 * exportação total, Capítulo 18.4). Nunca usado para servir um download ao
 * navegador — isso continua sendo `presignObjectDownload` (URL assinada direta no R2).
 */
export async function getObjectDirect(storageKey: string): Promise<Buffer> {  const { client, config } = await getR2Client();
  const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }));
  const body = result.Body;
  if (!body) {
    throw new Error(`Objeto "${storageKey}" não retornou corpo de resposta do R2.`);
  }
  const chunks: Buffer[] = [];
  // O SDK v3 tipa `Body` como `StreamingBlobPayloadOutputTypes` (union ampla); em
  // runtime Node.js é sempre um `Readable` real, iterável com for-await.
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * fa-w4-export-worker-oom / fa-w4-backup-worker-oom — versão EM STREAM de
 * `getObjectDirect`: devolve o `Readable` do SDK diretamente, sem nunca materializar
 * o objeto inteiro em memória (usado para empacotar XMLs/fotos grandes direto no ZIP
 * de exportação sem baixar o arquivo inteiro primeiro).
 */
export async function getObjectStream(storageKey: string): Promise<Readable> {
  const { client, config } = await getR2Client();
  const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }));
  if (!result.Body) {
    throw new Error(`Objeto "${storageKey}" não retornou corpo de resposta do R2.`);
  }
  // Mesma observação de `getObjectDirect`: em runtime Node.js o `Body` do SDK v3 é
  // sempre um `Readable` real (não um `Blob`/`ReadableStream` do browser).
  return result.Body as Readable;
}

/**
 * fa-w4-lgpd-no-retention-purge — apaga DEFINITIVAMENTE um objeto do R2 pela sua
 * `storageKey`. Usado exclusivamente por jobs de expurgo de retenção (ex.:
 * `workers/data-retention-purge.worker.ts`) sobre artefatos cujo ciclo de vida já
 * terminou (ex.: ZIP de exportação LGPD já baixado/expirado) — nunca deve ser
 * chamado a partir de um fluxo de usuário comum. DeleteObjectCommand do R2/S3 é
 * idempotente (não lança se a chave já não existir), então um expurgo repetido
 * sobre a mesma chave é seguro.
 */
export async function deleteObjectDirect(storageKey: string): Promise<void> {
  const { client, config } = await getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }));
}

// Tamanho de parte do upload multipart — o mínimo exigido pela API S3 (e compatíveis
// como o R2) é 5 MiB para toda parte exceto a última; 8 MiB dá folga confortável
// mantendo o uso de memória do processo limitado a poucas partes em trânsito por vez,
// nunca ao tamanho do arquivo inteiro (fa-w4-backup-worker-oom/fa-w4-export-worker-oom).
const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;

/**
 * Upload multipart EM STREAM: consome `body` em pedaços, fazendo upload de cada
 * parte assim que acumula `MULTIPART_PART_SIZE_BYTES` — nunca materializa o arquivo
 * inteiro em memória de uma vez (ao contrário de `PutObjectCommand` com um `Buffer`
 * completo). Em caso de erro, aborta o upload multipart no R2 (nunca deixa partes
 * órfãs ocupando espaço/cobrança no bucket).
 */
async function uploadReadableAsMultipart(params: {
  client: S3Client;
  bucket: string;
  key: string;
  contentType: string;
  body: Readable | AsyncIterable<Buffer | Uint8Array>;
}): Promise<{ fileSizeBytes: number }> {
  const { client, bucket, key, contentType, body } = params;
  const create = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
  const uploadId = create.UploadId;
  if (!uploadId) {
    throw new Error(`R2/S3 não retornou UploadId ao iniciar o multipart upload de "${key}".`);
  }

  const parts: { ETag: string; PartNumber: number }[] = [];
  let partNumber = 1;
  let totalBytes = 0;
  let buffered: Buffer[] = [];
  let bufferedBytes = 0;

  async function flushPart(isFinal: boolean): Promise<void> {
    if (bufferedBytes === 0) {
      // Nunca envia uma parte vazia — só é um problema real se for a ÚNICA parte
      // (arquivo vazio), caso em que o S3/R2 exige pelo menos uma parte não vazia;
      // um arquivo de backup/ZIP vazio não é um cenário esperado, mas não quebra:
      // a `CompleteMultipartUploadCommand` abaixo simplesmente falharia de forma
      // clara nesse caso extremo em vez de silenciosamente.
      return;
    }
    const partBody = Buffer.concat(buffered, bufferedBytes);
    buffered = [];
    bufferedBytes = 0;
    const result = await client.send(
      new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: partBody }),
    );
    if (!result.ETag) {
      throw new Error(`R2/S3 não retornou ETag para a parte ${partNumber} do upload multipart de "${key}".`);
    }
    parts.push({ ETag: result.ETag, PartNumber: partNumber });
    partNumber += 1;
    void isFinal;
  }

  try {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffered.push(buf);
      bufferedBytes += buf.byteLength;
      totalBytes += buf.byteLength;
      if (bufferedBytes >= MULTIPART_PART_SIZE_BYTES) {
        await flushPart(false);
      }
    }
    await flushPart(true); // última parte, pode ser menor que MULTIPART_PART_SIZE_BYTES (permitido pela API)
    if (parts.length === 0) {
      throw new Error(`Upload multipart de "${key}" não produziu nenhuma parte — stream de origem estava vazio.`);
    }
    await client.send(
      new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }),
    );
    return { fileSizeBytes: totalBytes };
  } catch (error) {
    await client
      .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
      .catch((abortError) => {
        log.error({ key, err: abortError }, "falha ao abortar multipart upload após erro — pode deixar partes órfãs no bucket");
      });
    throw error;
  }
}

export interface PutObjectStreamInput {
  tenantId: string;
  category: StorageCategory;
  fileName: string;
  mimeType: string;
  body: Readable;
}

/**
 * fa-w4-export-worker-oom — equivalente EM STREAM de `putObjectDirect`: usado pelo
 * worker de exportação de dados para gravar o ZIP diretamente do `archiver` sem
 * nunca concatenar o arquivo inteiro em um `Buffer` antes do upload.
 */
export async function putObjectStream(input: PutObjectStreamInput): Promise<{ storageKey: string; fileSizeBytes: number }> {
  const categoryDef = STORAGE_CATEGORIES[input.category];
  if (!categoryDef.allowedMimeTypes.includes(input.mimeType as never)) {
    throw new Error(`Tipo de arquivo não permitido para "${input.category}": ${input.mimeType}.`);
  }
  const { client, config } = await getR2Client();
  const storageKey = `tenants/${input.tenantId}/${input.category}/${crypto.randomUUID()}-${sanitizeFileName(input.fileName)}`;
  const { fileSizeBytes } = await uploadReadableAsMultipart({
    client,
    bucket: config.bucket,
    key: storageKey,
    contentType: input.mimeType,
    body: input.body,
  });
  if (fileSizeBytes > categoryDef.maxBytes) {
    // O limite de tamanho só pode ser verificado DEPOIS do upload em modo stream (o
    // tamanho final não é conhecido antecipadamente) — remove o objeto já enviado em
    // vez de deixar um arquivo acima do limite da categoria silenciosamente no bucket.
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey })).catch(() => {});
    throw new Error(`Arquivo de ${fileSizeBytes} bytes excede o máximo de ${categoryDef.maxBytes} bytes para "${input.category}".`);
  }
  return { storageKey, fileSizeBytes };
}

export interface PutPlatformObjectStreamInput {
  category: Extract<StorageCategory, "database-backups">;
  fileName: string;
  mimeType: string;
  body: Readable;
}

/**
 * fa-w4-backup-worker-oom — equivalente EM STREAM de `putPlatformObjectDirect`: usado
 * pelo worker de backup criptografado para fazer upload do dump comprimido/cifrado
 * conforme ele é gerado, nunca depois de montar o `.enc` inteiro em memória.
 */
export async function putPlatformObjectStream(input: PutPlatformObjectStreamInput): Promise<{ storageKey: string; fileSizeBytes: number }> {
  const categoryDef = STORAGE_CATEGORIES[input.category];
  if (!categoryDef.allowedMimeTypes.includes(input.mimeType as never)) {
    throw new Error(`Tipo de arquivo não permitido para "${input.category}": ${input.mimeType}.`);
  }
  const { client, config } = await getR2Client();
  const storageKey = `platform/${input.category}/${crypto.randomUUID()}-${sanitizeFileName(input.fileName)}`;
  const { fileSizeBytes } = await uploadReadableAsMultipart({
    client,
    bucket: config.bucket,
    key: storageKey,
    contentType: input.mimeType,
    body: input.body,
  });
  if (fileSizeBytes > categoryDef.maxBytes) {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey })).catch(() => {});
    throw new Error(`Arquivo de ${fileSizeBytes} bytes excede o máximo de ${categoryDef.maxBytes} bytes para "${input.category}".`);
  }
  return { storageKey, fileSizeBytes };
}
