// apps/api/src/lib/envelope-crypto.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 20 ("Payload cifrado com AES-256-GCM —
// chave de envelope via KMS, nunca a credencial em texto puro no banco") — a
// prosa do Bible referenciava `decryptEnvelope`/`encryptEnvelope` em vários
// capítulos (4972, 5627, 7189) sem nunca definir a implementação real. Esta é
// essa implementação, de fato funcional (não um stub).
//
// Esquema de envelope encryption real: cada credencial recebe uma DEK (Data
// Encryption Key) de 256 bits gerada aleatoriamente, que cifra o payload via
// AES-256-GCM; a própria DEK é então cifrada ("wrapped") com a KEK (Key
// Encryption Key) mestra, cujo material vem de `INTEGRATION_CREDENTIALS_MASTER_KEY`
// (32 bytes em base64). Isso permite rotação de KEK sem reprocessar todos os
// payloads: `encryptionKeyId` identifica qual versão de KEK foi usada para
// envelopar aquela DEK específica.
//
// Nota de produção: em produção real, a KEK deve vir de um KMS gerenciado
// (AWS KMS, GCP Cloud KMS, HashiCorp Vault) em vez de uma variável de ambiente
// estática — a função `resolveMasterKey` é o único ponto de troca necessário
// para plugar um KMS real sem tocar no restante do código.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, recomendado para GCM
const AUTH_TAG_LENGTH = 16;

export interface EncryptedEnvelope {
  // Buffer serializado: [ivDek(12) | authTagDek(16) | wrappedDek(32) | ivPayload(12) | authTagPayload(16) | ciphertext(N)]
  payload: Buffer;
  encryptionKeyId: string;
}

const CURRENT_KEY_ID = "v1";

function resolveMasterKey(keyId: string): Buffer {
  // Ponto único de troca para um KMS real — hoje resolve a partir de env var,
  // mas qualquer implementação futura (AWS KMS Decrypt/GenerateDataKey, etc.)
  // substitui apenas esta função, mantendo a mesma assinatura.
  const raw = process.env.INTEGRATION_CREDENTIALS_MASTER_KEY;
  if (!raw) {
    throw new Error(
      `INTEGRATION_CREDENTIALS_MASTER_KEY não configurada — impossível cifrar/decifrar credenciais de integração. Configure no .env do servidor (32 bytes em base64, ex.: "openssl rand -base64 32"). keyId solicitado: ${keyId}`,
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`INTEGRATION_CREDENTIALS_MASTER_KEY inválida: esperado 32 bytes após decode base64, recebido ${key.length}.`);
  }
  return key;
}

/** Cifra um objeto JSON arbitrário (ex.: { accessToken, phoneNumberId }) em um envelope real. */
export function encryptEnvelope(plaintextPayload: Record<string, unknown>): EncryptedEnvelope {
  const kek = resolveMasterKey(CURRENT_KEY_ID);
  const dek = randomBytes(32);

  // Envelopa (wrap) a DEK com a KEK.
  const ivDek = randomBytes(IV_LENGTH);
  const dekCipher = createCipheriv(ALGORITHM, kek, ivDek);
  const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const authTagDek = dekCipher.getAuthTag();

  // Cifra o payload real com a DEK.
  const ivPayload = randomBytes(IV_LENGTH);
  const payloadCipher = createCipheriv(ALGORITHM, dek, ivPayload);
  const plaintext = Buffer.from(JSON.stringify(plaintextPayload), "utf8");
  const ciphertext = Buffer.concat([payloadCipher.update(plaintext), payloadCipher.final()]);
  const authTagPayload = payloadCipher.getAuthTag();

  const serialized = Buffer.concat([ivDek, authTagDek, wrappedDek, ivPayload, authTagPayload, ciphertext]);
  return { payload: serialized, encryptionKeyId: CURRENT_KEY_ID };
}

/** Decifra um envelope previamente gerado por encryptEnvelope. */
export function decryptEnvelope(serialized: Buffer, encryptionKeyId: string): Record<string, unknown> {
  const kek = resolveMasterKey(encryptionKeyId);

  let offset = 0;
  const ivDek = serialized.subarray(offset, (offset += IV_LENGTH));
  const authTagDek = serialized.subarray(offset, (offset += AUTH_TAG_LENGTH));
  const wrappedDek = serialized.subarray(offset, (offset += 32)); // GCM é stream cipher: ciphertext da DEK tem o mesmo tamanho (32 bytes) do plaintext
  const ivPayload = serialized.subarray(offset, (offset += IV_LENGTH));
  const authTagPayload = serialized.subarray(offset, (offset += AUTH_TAG_LENGTH));
  const ciphertext = serialized.subarray(offset);

  const dekCipher = createDecipheriv(ALGORITHM, kek, ivDek);
  dekCipher.setAuthTag(authTagDek);
  const dek = Buffer.concat([dekCipher.update(wrappedDek), dekCipher.final()]);

  const payloadCipher = createDecipheriv(ALGORITHM, dek, ivPayload);
  payloadCipher.setAuthTag(authTagPayload);
  const plaintext = Buffer.concat([payloadCipher.update(ciphertext), payloadCipher.final()]);

  return JSON.parse(plaintext.toString("utf8"));
}
