// apps/api/src/lib/env-validation.ts
// fa-w5-boot-no-central-env-validation / fa-w5-boot-optional-integrations-lazy-failure:
// antes desta correção não existia um validador CENTRAL de variáveis de ambiente — cada
// módulo checava a sua sozinha, de forma ad-hoc e em momentos diferentes do boot
// (`lib/redis.ts`/`lib/queue.ts` lançam no import; `lib/jwt-keys.ts` lança no import;
// `CORS_ORIGIN` só era validado de forma assíncrona DEPOIS de `app.listen()` em
// server.ts, ou seja, o processo já estava aceitando conexões quando o alerta era
// logado; `DATABASE_URL` nunca era validado explicitamente — uma ausência só
// explodiria no primeiro `prisma.$queryRaw`). O resultado prático: um deploy com
// configuração incompleta podia subir "meio quebrado" (healthcheck verde, mas billing
// ou JWT quebrados) e só falhar na hora que um usuário de verdade batesse na rota
// certa.
//
// Este módulo roda como EFEITO COLATERAL DE IMPORT (igual ao padrão já usado em
// `lib/redis.ts`/`lib/queue.ts`/`lib/jwt-keys.ts`) — por isso precisa ser o PRIMEIRO
// import de `server.ts`/`worker.ts` depois de `dotenv/config` (que precisa rodar antes
// para popular `process.env` a partir do `.env` em dev). Import statements em ESM são
// avaliados em ordem de aparição, profundidade-primeiro, ANTES do próprio corpo do
// módulo que importa — ou seja, se este for o segundo import (logo após
// `dotenv/config`), seu efeito colateral roda ANTES de qualquer import subsequente
// (incluindo os que transitivamente puxam `lib/redis.ts`/`lib/jwt-keys.ts`), garantindo
// que o processo falhe com a lista AGREGADA de problemas em vez do primeiro módulo
// avulso que acontecer de ser avaliado primeiro.
//
// NO-OP fora de produção (NODE_ENV !== "production") — mesma convenção de
// `lib/redis.ts`/`lib/queue.ts`: nunca bloqueia dev local com um `.env` incompleto.
import { existsSync } from "node:fs";
import { z } from "zod";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("env-validation");

function isNonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Aceita tanto o PEM inline (`JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`, obrigatório no Railway,
// que não monta arquivos secretos) quanto o caminho de arquivo (`*_PATH`, usado pelo
// `deploy/generic-host` via Docker secrets) — mesmo contrato de `lib/jwt-keys.ts`.
function jwtKeyConfigured(inlineVar: string, pathVar: string): string | null {
  const inline = process.env[inlineVar];
  if (isNonEmpty(inline)) return null;
  const path = process.env[pathVar];
  if (!isNonEmpty(path)) {
    return `Defina ${inlineVar} (conteúdo PEM) ou ${pathVar} (caminho do arquivo) — nenhum dos dois está configurado.`;
  }
  if (!existsSync(path)) {
    return `${pathVar} aponta para um arquivo que não existe: ${path}`;
  }
  return null;
}

// `openssl rand -base64 32` produz 44 caracteres base64 (32 bytes + padding) — valida o
// formato sem decodificar de verdade (evita depender de buffer/encoding aqui).
function isValidBase64Key32(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+=*$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

interface RequiredGroup {
  /** Nome legível do grupo (ex.: "Stripe", "Asaas") usado nas mensagens de erro. */
  name: string;
  /** Vars que, se QUALQUER UMA estiver presente, tornam o grupo "em uso" (ativa a checagem). */
  triggerVars: string[];
  /** Vars que TODAS precisam estar presentes quando o grupo está "em uso". */
  requiredVars: string[];
}

// fa-w5-boot-optional-integrations-lazy-failure: integrações opcionais (tudo exceto
// billing, que tem a regra dedicada mais abaixo) são validadas em GRUPO — exigi-las
// incondicionalmente quebraria instalações que simplesmente não usam aquela
// integração. Mas se o operador já começou a configurar uma (ex.: só
// `PLUGGY_CLIENT_ID` sem o `_SECRET` correspondente), é quase certo que é um erro de
// configuração incompleta, não uma omissão intencional — falha no boot em vez de só
// na primeira chamada real à API externa.
const OPTIONAL_INTEGRATION_GROUPS: RequiredGroup[] = [
  {
    name: "WhatsApp Business API",
    triggerVars: ["WHATSAPP_BUSINESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    requiredVars: ["WHATSAPP_BUSINESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
  },
  {
    name: "Open Finance (Pluggy)",
    triggerVars: ["PLUGGY_CLIENT_ID", "PLUGGY_CLIENT_SECRET"],
    requiredVars: ["PLUGGY_CLIENT_ID", "PLUGGY_CLIENT_SECRET"],
  },
  {
    name: "Object Storage (Cloudflare R2)",
    triggerVars: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"],
    requiredVars: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"],
  },
];

function stripeFullyConfigured(): boolean {
  return (
    isNonEmpty(process.env.STRIPE_SECRET_KEY) &&
    isNonEmpty(process.env.STRIPE_WEBHOOK_SECRET) &&
    process.env.STRIPE_SECRET_KEY!.startsWith("sk_") &&
    process.env.STRIPE_WEBHOOK_SECRET!.startsWith("whsec_")
  );
}

function asaasFullyConfigured(): boolean {
  // `apps/api/src/modules/billing/asaas.client.ts` só exige API key (ASAAS_BASE_URL
  // tem default); o webhook token é validado em `webhooks.routes.ts` ao processar
  // eventos recebidos — sem ele, todo webhook do Asaas é silenciosamente rejeitado.
  return isNonEmpty(process.env.ASAAS_API_KEY) && isNonEmpty(process.env.ASAAS_WEBHOOK_TOKEN);
}

// fa-w5-boot-no-central-env-validation: schema Zod central — `.passthrough()` porque
// `process.env` tem centenas de outras chaves do SO/plataforma que não nos interessam
// aqui.
//
// IMPORTANTE: todas as regras — incluindo as obrigatórias incondicionais
// (DATABASE_URL/REDIS_URL/INTEGRATION_CREDENTIALS_MASTER_KEY) — são expressas dentro de
// um ÚNICO `superRefine`, e não como validações de campo (`z.object({ DATABASE_URL:
// z.string()... })`). Isso é proposital: no Zod, se uma validação de CAMPO falha
// (ex.: `.min(1)`), o `superRefine` do objeto é PULADO — ou seja, misturar validação de
// campo com `superRefine` faz com que, assim que o primeiro campo obrigatório falhar, as
// checagens de JWT/Stripe/Asaas/billing dentro do `superRefine` nunca rodem, violando o
// requisito deste achado de reportar a lista AGREGADA de TODOS os problemas (não só o
// primeiro). Colocando tudo em `superRefine`, `ctx.addIssue(...)` é sempre chamado para
// cada problema encontrado, independentemente de quantos outros já foram adicionados.
const bootEnvSchema = z
  .object({})
  .passthrough()
  .superRefine((env, ctx) => {
    // ── Variáveis obrigatórias incondicionais ───────────────────────────────
    const databaseUrl = env.DATABASE_URL as string | undefined;
    if (!isNonEmpty(databaseUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DATABASE_URL é obrigatório em produção (Postgres via Prisma).",
        path: ["DATABASE_URL"],
      });
    } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DATABASE_URL precisa começar com "postgres://" ou "postgresql://".',
        path: ["DATABASE_URL"],
      });
    }

    const redisUrl = env.REDIS_URL as string | undefined;
    if (!isNonEmpty(redisUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "REDIS_URL é obrigatório em produção (filas BullMQ + cache).",
        path: ["REDIS_URL"],
      });
    } else if (!/^rediss?:\/\//.test(redisUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'REDIS_URL precisa começar com "redis://" ou "rediss://".',
        path: ["REDIS_URL"],
      });
    }

    const masterKey = env.INTEGRATION_CREDENTIALS_MASTER_KEY as string | undefined;
    if (!isNonEmpty(masterKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "INTEGRATION_CREDENTIALS_MASTER_KEY é obrigatório em produção (KEK de 32 bytes base64 que cifra " +
          "credenciais de integração por tenant — gere com `openssl rand -base64 32`).",
        path: ["INTEGRATION_CREDENTIALS_MASTER_KEY"],
      });
    } else if (!isValidBase64Key32(masterKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "INTEGRATION_CREDENTIALS_MASTER_KEY precisa ser uma chave de 32 bytes em base64 (gere com " +
          "`openssl rand -base64 32`) — o valor atual não decodifica para 32 bytes.",
        path: ["INTEGRATION_CREDENTIALS_MASTER_KEY"],
      });
    }

    // ── Chaves JWT RS256 (inline PEM ou *_PATH) ─────────────────────────────
    const jwtPrivateIssue = jwtKeyConfigured("JWT_PRIVATE_KEY", "JWT_PRIVATE_KEY_PATH");
    if (jwtPrivateIssue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: jwtPrivateIssue, path: ["JWT_PRIVATE_KEY"] });
    const jwtPublicIssue = jwtKeyConfigured("JWT_PUBLIC_KEY", "JWT_PUBLIC_KEY_PATH");
    if (jwtPublicIssue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: jwtPublicIssue, path: ["JWT_PUBLIC_KEY"] });

    // ── Grupos condicionais de integrações opcionais ────────────────────────
    for (const group of OPTIONAL_INTEGRATION_GROUPS) {
      const anyTriggerPresent = group.triggerVars.some((v) => isNonEmpty(env[v as keyof typeof env] as string | undefined));
      if (!anyTriggerPresent) continue;
      const missing = group.requiredVars.filter((v) => !isNonEmpty(env[v as keyof typeof env] as string | undefined));
      if (missing.length === 0) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `Integração "${group.name}" parcialmente configurada — faltam: ${missing.join(", ")}. ` +
          "Configure todas as variáveis do grupo ou nenhuma (ver .env.example).",
        path: [group.name],
      });
    }

    // ── Consistência de par Stripe/Asaas (um sem o outro é quase sempre erro) ─
    const hasStripeSecret = isNonEmpty(env.STRIPE_SECRET_KEY as string | undefined);
    const hasStripeWebhook = isNonEmpty(env.STRIPE_WEBHOOK_SECRET as string | undefined);
    if (hasStripeSecret !== hasStripeWebhook) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Stripe parcialmente configurado: STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET precisam estar " +
          "ambos presentes ou ambos ausentes.",
        path: ["STRIPE_SECRET_KEY"],
      });
    }
    const hasAsaasKey = isNonEmpty(env.ASAAS_API_KEY as string | undefined);
    const hasAsaasWebhookToken = isNonEmpty(env.ASAAS_WEBHOOK_TOKEN as string | undefined);
    if (hasAsaasKey !== hasAsaasWebhookToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Asaas parcialmente configurado: ASAAS_API_KEY e ASAAS_WEBHOOK_TOKEN precisam estar ambos " +
          "presentes ou ambos ausentes.",
        path: ["ASAAS_API_KEY"],
      });
    }

    // ── Invariante de billing (fa-w5-boot-optional-integrations-lazy-failure) ─
    // Billing é core de um SaaS — ao contrário dos grupos opcionais acima, aqui
    // exigimos que PELO MENOS UM provedor esteja completo e bem formado, do
    // contrário nenhum checkout de assinatura jamais funcionará e o primeiro
    // sintoma só apareceria no carrinho de um cliente de verdade.
    //
    // Escotilha deliberada: instalações que configuram Stripe/Asaas
    // EXCLUSIVAMENTE pelo painel admin (`PlatformSecret`, ver lib/platform-secrets.ts)
    // depois do primeiro boot — nunca via variável de ambiente — podem setar
    // BILLING_CONFIGURED_VIA_ADMIN_PANEL=true para reconhecer explicitamente que
    // esta validação (que não tem acesso ao Postgres neste estágio do boot) não
    // consegue enxergar a credencial, e pular esta checagem por decisão
    // consciente do operador em vez de omissão silenciosa.
    if (env.BILLING_CONFIGURED_VIA_ADMIN_PANEL !== "true" && !stripeFullyConfigured() && !asaasFullyConfigured()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Nenhum provedor de billing está configurado corretamente: defina o par completo " +
          "STRIPE_SECRET_KEY (sk_...) + STRIPE_WEBHOOK_SECRET (whsec_...) OU ASAAS_API_KEY + " +
          "ASAAS_WEBHOOK_TOKEN. Sem isso, nenhum checkout de assinatura funcionará. Se billing é " +
          "gerenciado EXCLUSIVAMENTE pelo painel admin (PlatformSecret), defina " +
          "BILLING_CONFIGURED_VIA_ADMIN_PANEL=true para reconhecer isso explicitamente e pular esta checagem.",
        path: ["BILLING"],
      });
    }
  });

export function collectBootEnvIssues(): string[] {
  const result = bootEnvSchema.safeParse(process.env);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "env";
    return `${pathLabel}: ${issue.message}`;
  });
}

export function validateBootEnv(processName: string): void {
  if (process.env.NODE_ENV !== "production") {
    // NO-OP fora de produção — não bloqueia dev local com `.env` incompleto.
    return;
  }

  const issues = collectBootEnvIssues();
  if (issues.length === 0) {
    log.info({ processName }, "validação de variáveis de ambiente de boot: OK");
    return;
  }

  log.fatal(
    { processName, issueCount: issues.length, issues },
    `validação de variáveis de ambiente de boot FALHOU com ${issues.length} problema(s) — processo não pode subir com configuração incompleta/inválida em produção.`,
  );
  // Lista também em texto plano no stderr (além do log estruturado acima) — mais
  // fácil de ler direto no painel de logs do Railway sem precisar parsear JSON.
  console.error(`\n[env-validation] ${issues.length} problema(s) de configuração de ambiente:`);
  for (const [index, issue] of issues.entries()) {
    console.error(`  ${index + 1}. ${issue}`);
  }
  console.error("");
  process.exit(1);
}

validateBootEnv(process.env.APP_ROLE === "worker" ? "filitech-worker" : "filitech-api");
