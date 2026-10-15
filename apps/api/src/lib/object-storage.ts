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
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import { getPlatformSecret } from "./platform-secrets";
import { isTenantStorageKey } from "./storage-key";

const PRESIGNED_UPLOAD_EXPIRES_SECONDS = 5 * 60; // 5 min — suficiente para o upload direto do navegador, curto o bastante para não deixar a URL viva por muito tempo.
const PRESIGNED_DOWNLOAD_EXPIRES_SECONDS = 15 * 60; // 15 min — tempo de visualizar/baixar uma foto/XML no painel.

/** Categorias de objeto permitidas (Capítulo 3) — grava a allowlist de extensão/mimetype por categoria para nunca aceitar upload arbitrário. */
export const STORAGE_CATEGORIES = {
  "work-order-photos": { allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 15 * 1024 * 1024 },
  avatars: { allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024 },
  "fiscal-xml": { allowedMimeTypes: ["text/xml", "application/xml"], maxBytes: 2 * 1024 * 1024 },
  "client-record-photos": { allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 15 * 1024 * 1024 },
  "official-tax-documents": { allowedMimeTypes: ["text/plain", "application/xml"], maxBytes: 20 * 1024 * 1024 },
  // Capítulo 18.4 — ZIP final gerado por `data-export-generation.worker.ts`, upload
  // direto pelo backend (putObjectDirect), nunca pelo navegador.
  "data-export": { allowedMimeTypes: ["application/zip"], maxBytes: 500 * 1024 * 1024 },
  // Capítulo 18.5 — arquivo original (CSV/XLSX) enviado pelo lojista no wizard de
  // importação assistida, via presignObjectUpload (upload direto do navegador).
  "data-import-source": {
    allowedMimeTypes: ["text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    maxBytes: 20 * 1024 * 1024,
  },
  // Capítulo 18.5 — relatório de erros por linha (CSV) gerado pela etapa de
  // validação, upload direto pelo backend.
  "data-import-reports": { allowedMimeTypes: ["text/csv"], maxBytes: 10 * 1024 * 1024 },
} as const;
export type StorageCategory = keyof typeof STORAGE_CATEGORIES;

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

  if (config.publicBaseUrl) {
    // Bucket com Custom Domain público (Capítulo 3) — nenhuma necessidade de assinar;
    // a própria URL pública já é estável e cacheável por CDN.
    return { downloadUrl: `${config.publicBaseUrl.replace(/\/$/, "")}/${storageKey}`, expiresInSeconds: 0 };
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
export async function getObjectDirect(storageKey: string): Promise<Buffer> {
  const { client, config } = await getR2Client();
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
