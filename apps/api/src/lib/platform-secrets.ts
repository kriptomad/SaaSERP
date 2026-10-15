// apps/api/src/lib/platform-secrets.ts
// Fonte: pedido do usuário em 2026-10-13 — "crie uma aba na administração para eu poder
// configurar por lá, sem precisar ficar dependendo de env variable". Esta é a camada que
// qualquer módulo deve usar no lugar de ler `process.env.<CHAVE>` diretamente para
// credenciais de PLATAFORMA (Stripe, Asaas, etc. — não confundir com `IntegrationCredential`,
// que é por tenant).
//
// Resolução em cascata, nessa ordem:
//   1. `PlatformSecret` no banco (cifrado via envelope-crypto, editável no painel admin).
//   2. `process.env[key]` (fallback — primeiro boot antes de qualquer admin configurar,
//      ou ambientes que preferem continuar via variável de ambiente/secret manager externo).
//   3. `null`.
//
// Cache em memória com TTL curto: evita round-trip ao banco em toda chamada de Stripe/Asaas
// (ex.: todo evento de webhook), mas garante que uma troca pelo painel propague em segundos
// sem exigir redeploy/restart do processo — ponto central do pedido do usuário.
import { prismaUnscoped as prisma } from "@filitech/db";
import { encryptEnvelope, decryptEnvelope } from "./envelope-crypto";

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { value: string | null; expiresAt: number }>();

export interface PlatformSecretDefinition {
  key: string;
  label: string;
  group: "Stripe" | "Asaas" | "Licenciamento" | "Rede" | "Armazenamento (R2)" | "Open Finance (Pluggy)" | "Backup" | "Email (Plataforma)";
  description: string;
  /** Nome da variável de ambiente usada como fallback/compatibilidade — quase sempre igual a `key`. */
  envFallback: string;
  placeholder?: string;
}

// Registro central e exaustivo: toda credencial de plataforma hoje lida via `process.env`
// (fora das exceções documentadas no schema.prisma de `PlatformSecret`) precisa estar aqui.
// Isto é o que alimenta a listagem do painel admin — nunca inventar uma chave que não exista
// de fato em algum client/rota real.
export const PLATFORM_SECRET_REGISTRY: PlatformSecretDefinition[] = [
  {
    key: "STRIPE_SECRET_KEY",
    label: "Stripe — Secret Key",
    group: "Stripe",
    description: "Chave secreta da API Stripe (sk_live_... em produção, sk_test_... em homologação). Usada para criar SetupIntents, assinaturas e sincronizar assentos extras (Capítulo 2.7.3/2.9).",
    envFallback: "STRIPE_SECRET_KEY",
    placeholder: "sk_live_...",
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    label: "Stripe — Webhook Signing Secret",
    group: "Stripe",
    description: "Segredo usado para validar a assinatura HMAC dos webhooks do Stripe (whsec_...). Sem ele, os webhooks de billing são rejeitados com 400.",
    envFallback: "STRIPE_WEBHOOK_SECRET",
    placeholder: "whsec_...",
  },
  {
    key: "ASAAS_API_KEY",
    label: "Asaas — API Key",
    group: "Asaas",
    description: "Token de acesso da API do Asaas (tokenização de cartão + assinaturas recorrentes, Capítulo 2.7.2).",
    envFallback: "ASAAS_API_KEY",
    placeholder: "$aact_...",
  },
  {
    key: "ASAAS_BASE_URL",
    label: "Asaas — Base URL",
    group: "Asaas",
    description: "URL base da API do Asaas. Produção: https://www.asaas.com/api/v3 · Sandbox: https://sandbox.asaas.com/api/v3.",
    envFallback: "ASAAS_BASE_URL",
    placeholder: "https://www.asaas.com/api/v3",
  },
  {
    key: "ASAAS_WEBHOOK_TOKEN",
    label: "Asaas — Webhook Token",
    group: "Asaas",
    description: "Token enviado pelo Asaas no header do webhook (configurado no painel do Asaas); validado contra este valor antes de processar o evento.",
    envFallback: "ASAAS_WEBHOOK_TOKEN",
  },
  {
    key: "CORS_ORIGIN",
    label: "Origens CORS permitidas",
    group: "Rede",
    description: "Lista de origens HTTP permitidas a chamar a API, separadas por vírgula, sem barra final (ex.: https://app.filitecherp.com.br,https://filitech.vercel.app). Sem valor configurado, a API libera qualquer origem (*) — inseguro em produção.",
    envFallback: "CORS_ORIGIN",
    placeholder: "https://app.seudominio.com,https://seudominio.vercel.app",
  },
  {
    key: "LICENSE_OFFLINE_TOKEN_DAYS",
    label: "Licenciamento — validade do token offline (dias)",
    group: "Licenciamento",
    description: "Quantos dias o token de licença assinado (RS256) permanece válido para uso offline no app desktop antes de exigir nova validação online. Default: 7.",
    envFallback: "LICENSE_OFFLINE_TOKEN_DAYS",
    placeholder: "7",
  },
  {
    key: "R2_ACCOUNT_ID",
    label: "Cloudflare R2 — Account ID",
    group: "Armazenamento (R2)",
    description: "ID da conta Cloudflare usada para montar o endpoint S3-compatible do bucket (https://<account_id>.r2.cloudflarestorage.com), Capítulo 3 (Object Storage: avatares, fotos de equipamento/avaria, XMLs fiscais).",
    envFallback: "R2_ACCOUNT_ID",
    placeholder: "a1b2c3d4e5f6...",
  },
  {
    key: "R2_ACCESS_KEY_ID",
    label: "Cloudflare R2 — Access Key ID",
    group: "Armazenamento (R2)",
    description: "Access Key ID do token de API R2 (compatível com a API S3), com permissão de leitura/escrita apenas no bucket configurado abaixo.",
    envFallback: "R2_ACCESS_KEY_ID",
  },
  {
    key: "R2_SECRET_ACCESS_KEY",
    label: "Cloudflare R2 — Secret Access Key",
    group: "Armazenamento (R2)",
    description: "Secret Access Key pareado ao Access Key ID acima — nunca exibido em texto puro depois de salvo.",
    envFallback: "R2_SECRET_ACCESS_KEY",
  },
  {
    key: "R2_BUCKET_NAME",
    label: "Cloudflare R2 — Nome do bucket",
    group: "Armazenamento (R2)",
    description: "Bucket único da plataforma onde todos os objetos de todos os tenants são gravados, isolados por prefixo de chave `tenants/<tenantId>/...` (nunca um bucket por tenant).",
    envFallback: "R2_BUCKET_NAME",
    placeholder: "filitech-erp-prod",
  },
  {
    key: "R2_PUBLIC_BASE_URL",
    label: "Cloudflare R2 — URL pública/CDN (opcional)",
    group: "Armazenamento (R2)",
    description: "Domínio público (bucket com Custom Domain do Cloudflare) usado para servir objetos que não exigem URL assinada (ex.: avatares). Se vazio, todo objeto é servido via URL assinada de leitura com expiração curta.",
    envFallback: "R2_PUBLIC_BASE_URL",
    placeholder: "https://assets.filitecherp.com.br",
  },
  {
    key: "PLUGGY_CLIENT_ID",
    label: "Pluggy — Client ID",
    group: "Open Finance (Pluggy)",
    description: "Client ID da aplicação cadastrada no Pluggy (agregador Open Finance homologado pelo Banco Central, Capítulo 17.4.1/22.5). Credencial ÚNICA DE PLATAFORMA — nunca por tenant: a Pluggy já separa os dados por `itemId`/`accountId` de cada conexão, então o isolamento multi-tenant acontece no dado (OpenFinanceConsent.tenantId), não na credencial.",
    envFallback: "PLUGGY_CLIENT_ID",
  },
  {
    key: "PLUGGY_CLIENT_SECRET",
    label: "Pluggy — Client Secret",
    group: "Open Finance (Pluggy)",
    description: "Client Secret pareado ao Client ID acima, usado em `POST /auth` da Pluggy para emitir o `apiKey` de curta duração (2h) usado em todas as outras chamadas server-to-server.",
    envFallback: "PLUGGY_CLIENT_SECRET",
  },
  {
    key: "PLUGGY_WEBHOOK_TOKEN",
    label: "Pluggy — Token do webhook",
    group: "Open Finance (Pluggy)",
    description: "A Pluggy não assina/autentica as requisições de webhook (confirmado na documentação oficial — não existe header de assinatura HMAC equivalente ao do Stripe/iFood). A proteção real aqui é um segredo gerado por nós e embutido como query string (`?token=...`) na `webhookUrl` cadastrada no painel/Connect Token da Pluggy; esta rota compara o `token` recebido contra este valor (comparação timing-safe) antes de processar qualquer evento.",
    envFallback: "PLUGGY_WEBHOOK_TOKEN",
  },
  {
    key: "BACKUP_ENCRYPTION_KEY",
    label: "Backup — Chave de criptografia (AES-256-GCM)",
    group: "Backup",
    description: "Chave de 32 bytes em hexadecimal (64 caracteres hex) usada para cifrar o dump completo do banco antes de subir ao R2 (Capítulo 10.3). Gere com `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"`. Trocar esta chave torna backups antigos ilegíveis — nunca remover sem antes restaurar/arquivar os backups existentes.",
    envFallback: "BACKUP_ENCRYPTION_KEY",
    placeholder: "64 caracteres hexadecimais",
  },
  {
    key: "PLATFORM_RESEND_API_KEY",
    label: "E-mail — Resend API Key (plataforma)",
    group: "Email (Plataforma)",
    description: "Chave da API Resend (re_...) usada EXCLUSIVAMENTE para e-mails transacionais da plataforma (ex.: reset de senha de admin da plataforma) — não confundir com a credencial EMAIL_RESEND por tenant em IntegrationCredential. Sem esta chave, links de reset de senha de admin caem no fallback de log estruturado.",
    envFallback: "PLATFORM_RESEND_API_KEY",
    placeholder: "re_...",
  },
  {
    key: "PLATFORM_RESEND_FROM_ADDRESS",
    label: "E-mail — Endereço remetente (plataforma)",
    group: "Email (Plataforma)",
    description: "Endereço \"De\" usado nos e-mails transacionais da plataforma (precisa ser um domínio verificado na Resend).",
    envFallback: "PLATFORM_RESEND_FROM_ADDRESS",
    placeholder: "contato@filitecherp.com.br",
  },
];

const REGISTRY_BY_KEY = new Map(PLATFORM_SECRET_REGISTRY.map((d) => [d.key, d]));

function getCached(key: string): { hit: boolean; value: string | null } {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return { hit: true, value: entry.value };
  }
  return { hit: false, value: null };
}

function setCache(key: string, value: string | null) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Invalida o cache de uma chave (chamado logo após gravação pelo painel admin). */
export function invalidatePlatformSecretCache(key: string): void {
  cache.delete(key);
}

/**
 * Resolve o valor de uma credencial de plataforma: banco (painel admin) → env var → null.
 * Uso: `await getPlatformSecret("STRIPE_SECRET_KEY")` em vez de `process.env.STRIPE_SECRET_KEY`.
 */
export async function getPlatformSecret(key: string): Promise<string | null> {
  const cached = getCached(key);
  if (cached.hit) return cached.value;

  const row = await prisma.platformSecret.findUnique({ where: { key } });
  if (row) {
    try {
      const decrypted = decryptEnvelope(Buffer.from(row.encryptedPayload), row.encryptionKeyId) as { value: string };
      setCache(key, decrypted.value);
      return decrypted.value;
    } catch {
      // KEK rotacionada sem reprocessamento, ou payload corrompido — cai para o fallback de
      // env var em vez de quebrar a chamada inteira, igual ao precedente de IntegrationCredential.
    }
  }

  const definition = REGISTRY_BY_KEY.get(key);
  const envValue = process.env[definition?.envFallback ?? key] ?? null;
  setCache(key, envValue);
  return envValue;
}

/** Grava/sobrescreve uma credencial de plataforma no banco, cifrada. `null`/"" remove o override (volta a usar env var). */
export async function setPlatformSecret(key: string, value: string | null, platformAdminUserId: string): Promise<void> {
  if (!REGISTRY_BY_KEY.has(key)) {
    throw new Error(`Chave de credencial de plataforma desconhecida: ${key}. Adicione a definição em PLATFORM_SECRET_REGISTRY antes de gravar.`);
  }
  if (!value) {
    await prisma.platformSecret.deleteMany({ where: { key } });
    invalidatePlatformSecretCache(key);
    return;
  }
  const { payload, encryptionKeyId } = encryptEnvelope({ value });
  await prisma.platformSecret.upsert({
    where: { key },
    create: { key, encryptedPayload: payload, encryptionKeyId, updatedByPlatformAdminUserId: platformAdminUserId },
    update: { encryptedPayload: payload, encryptionKeyId, updatedByPlatformAdminUserId: platformAdminUserId },
  });
  invalidatePlatformSecretCache(key);
}

function maskSecret(value: string): string {
  if (value.length === 0) return "••••";
  const visibleSuffix = value.length >= 12 ? value.slice(-4) : "";
  return `${"•".repeat(Math.min(8, Math.max(4, value.length - visibleSuffix.length)))}${visibleSuffix}`;
}

export interface PlatformSecretStatus extends PlatformSecretDefinition {
  configuredSource: "database" | "env" | "none";
  maskedValue: string | null;
  updatedAt: string | null;
}

/** Visão para o painel admin: nunca devolve o valor real, só a origem e um preview mascarado. */
export async function listPlatformSecretStatuses(): Promise<PlatformSecretStatus[]> {
  const rows = await prisma.platformSecret.findMany({ where: { key: { in: PLATFORM_SECRET_REGISTRY.map((d) => d.key) } } });
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  return Promise.all(
    PLATFORM_SECRET_REGISTRY.map(async (definition) => {
      const row = rowByKey.get(definition.key);
      if (row) {
        try {
          const decrypted = decryptEnvelope(Buffer.from(row.encryptedPayload), row.encryptionKeyId) as { value: string };
          return {
            ...definition,
            configuredSource: "database" as const,
            maskedValue: maskSecret(decrypted.value),
            updatedAt: row.updatedAt.toISOString(),
          };
        } catch {
          return { ...definition, configuredSource: "database" as const, maskedValue: "⚠️ erro ao decifrar", updatedAt: row.updatedAt.toISOString() };
        }
      }
      const envValue = process.env[definition.envFallback];
      if (envValue) {
        return { ...definition, configuredSource: "env" as const, maskedValue: maskSecret(envValue), updatedAt: null };
      }
      return { ...definition, configuredSource: "none" as const, maskedValue: null, updatedAt: null };
    }),
  );
}
