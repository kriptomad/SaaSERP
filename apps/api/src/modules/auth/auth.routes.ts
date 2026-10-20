// apps/api/src/modules/auth/auth.routes.ts
// Rotas reais de autenticação: signup de tenant (onboarding, Capítulo 1.2) e login
// (JWT RS256, Capítulo 3.5). Usa prismaUnscoped porque ainda não há tenantId de sessão
// nessas duas rotas (são as únicas formas legítimas de criar/entrar em um tenant).
import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { prismaUnscoped } from "@filitech/db";
import { hashPassword, verifyPassword } from "./password.service";
import { signSessionToken } from "./jwt.service";
import { enforceRateLimit, resetRateLimit, RateLimitExceededError } from "../../lib/rate-limit";
import { isTenantLocked } from "../../middlewares/tenant-lockout.middleware";
import {
  authMiddleware,
  requireAuth,
  invalidateImpersonationSessionCache,
  invalidateUserTokenVersionCache,
  invalidateUserSessionCache,
  hashSessionId,
} from "../../middlewares/auth.middleware";
import { isValidCnpj } from "../../lib/br-documents";
import { validatePasswordPolicy } from "../../lib/password-policy";
import { sendPlatformEmail } from "../../lib/platform-email";
import { getPlatformSecret } from "../../lib/platform-secrets";
import { createModuleLogger } from "../../lib/logger";
import { zodValidationErrorResponse } from "../../lib/validation-error";
import { escapeHtml } from "../../lib/html-escape";

export const authRouter = Router();

const logger = createModuleLogger("tenant-auth");

// GAP DE AUDITORIA FECHADO (Rodada 6) — só existia reset de senha para
// PlatformAdminUser (platform-admin-auth.routes.ts, Capítulo 14.3). Um usuário
// comum de tenant (OWNER/MANAGER/TECHNICIAN/CASHIER) que esquecesse a senha não
// tinha NENHUMA forma de recuperar a conta além de um OWNER recadastrá-lo na mão.
// Mesmo padrão de segurança já usado para admins (token opaco de uso único, hash
// SHA-256 persistido, janela curta de validade, resposta sempre genérica para
// nunca permitir enumeração de e-mail) — reaproveita o MESMO model
// `PasswordResetToken`, que já nasceu com `userId` nulável exatamente para esta
// extensão (ver comentário no schema.prisma).
const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;

// CORREÇÃO DE AUDITORIA (fa-w6-sess-no-tenant-session-management): extrai
// IP/user-agent da requisição de login/signup para gravar na `ActiveSession`
// criada — mesmos dados já coletados pelo painel de plataforma
// (platform-admin-auth.routes.ts) para a listagem "Sessões ativas".
function clientIp(req: { ip?: string }): string {
  return req.ip ?? "0.0.0.0";
}

function clientUserAgent(req: { headers: Record<string, unknown> }): string {
  const header = req.headers["user-agent"];
  return typeof header === "string" && header.length > 0 ? header.slice(0, 500) : "desconhecido";
}

const signupSchema = z.object({
  legalName: z.string().min(2),
  tradeName: z.string().min(2),
  slug: z
    .string()
    .min(3)
    .regex(/^[a-z0-9-]+$/, "slug deve conter apenas letras minúsculas, números e hífen"),
  cnpj: z.string().optional(),
  tenantType: z.enum(["BUSINESS", "PERSONAL", "ACCOUNTING_OFFICE"]).default("BUSINESS"),
  ownerName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8),
  // GAP DE AUDITORIA FECHADO (mega-audit rodada 5): aceite dos Termos de Uso e da
  // Política de Privacidade agora é obrigatório e validado no backend (nunca apenas
  // "confiado" ao frontend) — requisito legal (LGPD) para prova de consentimento.
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "É necessário aceitar os Termos de Uso e a Política de Privacidade para criar uma conta." }) }),
});

authRouter.post("/signup", async (req, res) => {
  // GAP DE AUDITORIA FECHADO: signup criava tenant+usuário sem nenhum rate
  // limiting, diferente de /login e /password-reset/request no mesmo arquivo —
  // permitia criação automatizada ilimitada de tenants/contas a partir do mesmo IP.
  try {
    await enforceRateLimit(`signup:${req.ip}`, 5, 900);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return zodValidationErrorResponse(res, parsed.error);
  }
  const input = parsed.data;

  // CNPJ obrigatório apenas para tenantType = BUSINESS (Capítulo 22.1).
  if (input.tenantType === "BUSINESS" && !input.cnpj) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "cnpj é obrigatório para tenantType BUSINESS." } });
  }
  // Validação real de dígito verificador — aceita tanto CNPJ numérico tradicional
  // quanto o novo formato alfanumérico da Receita Federal (ver lib/br-documents.ts).
  // Checado sempre que um CNPJ é informado, independente do tenantType.
  if (input.cnpj && !isValidCnpj(input.cnpj)) {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_CNPJ", message: "CNPJ inválido (dígito verificador não confere)." } });
  }
  const passwordPolicy = validatePasswordPolicy(input.ownerPassword);
  if (!passwordPolicy.valid) {
    return res.status(400).json({ success: false, data: null, error: { code: "WEAK_PASSWORD", message: passwordPolicy.errors.join(" ") } });
  }

  const existingSlug = await prismaUnscoped.tenant.findUnique({ where: { slug: input.slug } });
  if (existingSlug) {
    return res.status(409).json({ success: false, data: null, error: { code: "SLUG_TAKEN", message: "Este identificador já está em uso." } });
  }

  const passwordHash = await hashPassword(input.ownerPassword);

  // GAP DE AUDITORIA FECHADO (mega-audit rodada 5): `Tenant.termsVersionAccepted`/
  // `privacyPolicyVersionAccepted` já existiam no schema, mas nenhuma rota de
  // signup realmente consultava `LegalDocumentVersion` nem gravava o aceite —
  // nunca gravamos uma versão "fixa"/hardcoded aqui: buscamos a versão REALMENTE
  // publicada mais recente de cada tipo de documento no momento do cadastro, para
  // que o registro de consentimento seja auditável mesmo após o texto mudar.
  const [latestTerms, latestPrivacy] = await Promise.all([
    prismaUnscoped.legalDocumentVersion.findFirst({ where: { documentType: "TERMS_OF_USE" }, orderBy: { publishedAt: "desc" } }),
    prismaUnscoped.legalDocumentVersion.findFirst({ where: { documentType: "PRIVACY_POLICY" }, orderBy: { publishedAt: "desc" } }),
  ]);

  let created;
  try {
    created = await prismaUnscoped.$transaction(async (tx) => {
    const createdTenant = await tx.tenant.create({
      data: {
        legalName: input.legalName,
        tradeName: input.tradeName,
        slug: input.slug,
        cnpj: input.cnpj ?? null,
        tenantType: input.tenantType,
        status: "TRIAL",
        // fa-w6-bl-no-trial-expiry-enforcement: antes, o trial SaaS nunca expirava
        // sozinho — um tenant TRIAL sem assinatura paga permanecia com acesso
        // completo indefinidamente. 14 dias é uma suposição documentada (não há
        // regra de negócio explícita registrada na Bible para o trial SaaS,
        // distinto do trial de 15 dias da Licença Mestra técnica em
        // `licensing.routes.ts`); ajustável revisando apenas este valor.
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        termsAcceptedAt: new Date(),
        termsVersionAccepted: latestTerms?.version ?? null,
        privacyPolicyAcceptedAt: new Date(),
        privacyPolicyVersionAccepted: latestPrivacy?.version ?? null,
      },
    });

    const createdOwner = await tx.user.create({
      data: {
        tenantId: createdTenant.id,
        name: input.ownerName,
        email: input.ownerEmail,
        passwordHash,
        role: "OWNER",
      },
    });

    // CORREÇÃO DE AUDITORIA (fa-w6-sess-no-tenant-session-management): toda
    // sessão de tenant criada a partir de agora (login OU signup) ganha um
    // registro `ActiveSession` rastreável/revogável (mesmo model já usado pelo
    // painel de plataforma, Capítulo 14.4) — `sid` aleatório embutido como claim
    // do JWT, apenas o HASH SHA-256 persistido no banco.
    const sid = randomUUID();
    await tx.activeSession.create({
      data: { userId: createdOwner.id, refreshTokenHash: hashSessionId(sid), ipAddress: clientIp(req), userAgent: clientUserAgent(req) },
    });

    return { tenant: createdTenant, owner: createdOwner, sid };
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "SLUG_TAKEN", message: "Este identificador já está em uso." } });
    }
    throw err;
  }
  const { tenant, owner, sid } = created;

  const token = signSessionToken({ userId: owner.id, tenantId: tenant.id, role: "OWNER", tokenVersion: owner.tokenVersion, sid });
  const authPayload = {
    token,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      tradeName: tenant.tradeName,
      status: tenant.status,
      tenantType: tenant.tenantType,
      cnpj: tenant.cnpj,
    },
    user: { id: owner.id, name: owner.name, email: owner.email, role: owner.role },
  };
  // CORREÇÃO DE AUDITORIA (fa-w6-api-auth-response-envelope-inconsistent): antes
  // duplicava token/tenant/user tanto em `data` quanto soltos na raiz da resposta
  // — único endpoint do backend a quebrar o envelope padrão {success,data,error}.
  // `apps/web/src/api/client.ts` (`signup()`) foi migrado para `api.post()` (que já
  // desembrulha `data` do envelope padrão, como todo o resto do app) no mesmo
  // commit — nunca leia os campos planos da raiz aqui.
  return res.status(201).json({ success: true, data: authPayload, error: null });
});

const loginSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return zodValidationErrorResponse(res, parsed.error);
  }
  const { tenantSlug, email, password } = parsed.data;

  // Rate limiting por tentativas falhas (Capítulo 14.3, mesmo padrão "Redis INCR com
  // TTL" já usado em manager-pin.service.ts): 5 tentativas a cada 15 minutos por
  // tenant+e-mail, namespace isolado por tenant — um invasor tentando força bruta
  // contra a conta de um lojista nunca consome/afeta o limite de outro tenant.
  const rateLimitKey = `tenant:${tenantSlug}:login:fail:${email.toLowerCase()}`;
  // CORREÇÃO DE AUDITORIA (fa-w6-sess-login-ratelimit-not-ip-scoped): o limite
  // acima é só por tenant+e-mail — um invasor de credential stuffing distribuído
  // (testando MUITAS combinações tenant+e-mail diferentes a partir do MESMO IP,
  // em vez de martelar uma única conta) nunca batia nesse limite, pois cada
  // tentativa usa uma chave diferente. Este segundo limite, por IP (não
  // namespace-isolado por tenant — deliberado: o objetivo é limitar o volume
  // total de tentativas de login que um único IP pode fazer contra QUALQUER
  // tenant/conta), é checado ALÉM do limite por conta — ambos precisam passar.
  // Janela/limite mais largos que o de conta (20 vs 5) porque um IP legítimo
  // (ex.: rede compartilhada de um escritório/loja) pode gerar várias tentativas
  // de contas diferentes em pouco tempo sem ser um ataque.
  const ipRateLimitKey = `login:fail:ip:${clientIp(req)}`;
  try {
    await enforceRateLimit(rateLimitKey, 5, 900);
    await enforceRateLimit(ipRateLimitKey, 20, 900);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }

  const tenant = await prismaUnscoped.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

  const user = await prismaUnscoped.user.findFirst({ where: { tenantId: tenant.id, email, active: true } });
  if (!user) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

  // Login válido: reseta o contador de tentativas falhas desta conta e deste IP.
  await resetRateLimit(rateLimitKey);
  await resetRateLimit(ipRateLimitKey);

  // Capítulo 2 — Tenant Lockout: bloqueia login se a assinatura estiver suspensa
  // ou (fa-w6-bl-no-trial-expiry-enforcement) se o trial SaaS já venceu — mesma
  // regra de `isTenantLocked`, nunca duplicada, para ficar sempre em sincronia
  // com o middleware global e o backstop de defesa em profundidade.
  if (isTenantLocked(tenant)) {
    return res.status(402).json({
      success: false, data: null, error: { code: "TENANT_LOCKED", message: "Este espaço está com a assinatura suspensa. Regularize o pagamento para continuar." },
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // GAP DE AUDITORIA DOCUMENTADO, NÃO IMPLEMENTADO NESTA RODADA
  // (fa-w6-sess-no-mfa-tenant-users, sev. 84): `User.totpSecretEncrypted` /
  // `User.totpConfirmedAt` / `TwoFactorBackupCode` (schema.prisma) já existem no
  // schema — o MESMO desenho de dados já usado para `PlatformAdminUser`
  // (Capítulo 14.1/14.2) — mas NENHUMA rota de enrollment/challenge/recovery
  // existe hoje para usuários de tenant (OWNER/MANAGER/TECHNICIAN/CASHIER/...).
  // Login de tenant, portanto, ainda é senha-única: comprometer a senha
  // (phishing, reuso de senha vazada, keylogger) é suficiente para assumir a
  // conta, sem nenhum segundo fator — diferente do painel de plataforma, que já
  // exige TOTP (`platform-admin-auth.routes.ts`).
  //
  // Decisão desta rodada: NÃO implementar o fluxo completo de TOTP/WebAuthn aqui
  // — é uma feature grande o suficiente (enrollment + UI de QR code + challenge
  // no login + fluxo de recuperação com backup codes) para merecer sua própria
  // rodada dedicada, em vez de uma adição apressada e mal testada dentro de uma
  // rodada de auditoria mais ampla. Esboço de design para a implementação futura
  // (evitar redescoberta), espelhando o que já existe no painel de plataforma:
  //   1. Enrollment (ex.: POST /auth/mfa/enroll, autenticado, igual ao painel):
  //      gera segredo TOTP (lib `otplib` ou `speakeasy`, já usada em
  //      platform-admin-auth.routes.ts — reaproveitar a mesma dependência),
  //      cifra com a mesma chave/`platform-secrets` usada para
  //      `totpSecretEncrypted` de PlatformAdminUser, grava em
  //      `User.totpSecretEncrypted` (ainda SEM marcar `totpConfirmedAt` — não
  //      habilitado até confirmar), retorna o QR code (otpauth:// URI) para o
  //      app autenticador do usuário.
  //   2. Confirmação (ex.: POST /auth/mfa/confirm): usuário envia o primeiro
  //      código de 6 dígitos gerado pelo app; validado contra o segredo
  //      decifrado (janela de tolerância de 1 passo, mesmo padrão do painel);
  //      se válido, grava `totpConfirmedAt = now()` (SÓ a partir daqui o MFA é
  //      "exigido" no login) e gera/grava os backup codes (hash, igual
  //      `TwoFactorBackupCode` do painel — nunca em claro).
  //   3. Challenge no login (AQUI, depois de `verifyPassword` acima): se
  //      `user.totpConfirmedAt` não for nulo, a resposta de /login NÃO deve
  //      emitir o JWT final diretamente — deve devolver um token de desafio
  //      opaco de curta duração (ex.: Redis, TTL ~5min, não um JWT de sessão) e
  //      o frontend chama POST /auth/mfa/verify com esse token + o código
  //      TOTP (ou um backup code) para só então receber o JWT de sessão real
  //      (com `sid`/`tokenVersion` como já feito abaixo).
  //   4. Recuperação: um backup code (de uso único, igual ao painel) substitui
  //      o código TOTP em `/auth/mfa/verify` quando o usuário perdeu o
  //      dispositivo autenticador; sempre reduzir a lista de códigos restantes
  //      e avisar o usuário quando sobrarem poucos.
  //   5. Aplicação por papel: `SystemParameter ENFORCE_2FA_FOR_ROLES` (citado no
  //      comentário de `User.totpConfirmedAt` no schema) já é o lugar pensado
  //      para tornar MFA OBRIGATÓRIO (não apenas opcional) para papéis
  //      sensíveis (ex.: OWNER) — checar aqui antes de permitir login sem MFA
  //      confirmado, quando aplicável ao papel do usuário.
  // ───────────────────────────────────────────────────────────────────────

  // CORREÇÃO DE AUDITORIA (fa-w6-sess-no-tenant-session-management): mesmo
  // registro de `ActiveSession` criado no signup (ver comentário lá) — login
  // também precisa ser rastreável/revogável, não só o cadastro inicial.
  const sid = randomUUID();
  await prismaUnscoped.activeSession.create({
    data: { userId: user.id, refreshTokenHash: hashSessionId(sid), ipAddress: clientIp(req), userAgent: clientUserAgent(req) },
  });

  const token = signSessionToken({ userId: user.id, tenantId: tenant.id, role: user.role as any, tokenVersion: user.tokenVersion, sid });
  const authPayload = {
    token,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      tradeName: tenant.tradeName,
      status: tenant.status,
      tenantType: tenant.tenantType,
      cnpj: tenant.cnpj,
    },
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
  // CORREÇÃO DE AUDITORIA (fa-w6-api-auth-response-envelope-inconsistent): ver
  // comentário equivalente em /signup acima — mesmo envelope padrão, sem
  // duplicação de campos na raiz.
  return res.json({ success: true, data: authPayload, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// RESET DE SENHA (usuário comum de tenant — OWNER/MANAGER/TECHNICIAN/CASHIER)
// ─────────────────────────────────────────────────────────────────────────

async function resolveAppBaseUrl(): Promise<string> {
  return (await getPlatformSecret("APP_BASE_URL")) ?? "https://app.filitecherp.com.br";
}

const passwordResetRequestSchema = z.object({ tenantSlug: z.string().min(1), email: z.string().email() });

authRouter.post("/auth/password-reset/request", async (req, res) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return zodValidationErrorResponse(res, parsed.error);
  }
  const { tenantSlug, email } = parsed.data;

  // Rate limiting por tentativas (mesmo padrão de login) — nunca permite que este
  // endpoint seja usado para martelar o envio de e-mails de reset contra uma conta.
  const rateLimitKey = `tenant:${tenantSlug}:password-reset:request:${email.toLowerCase()}`;
  // CORREÇÃO DE AUDITORIA (fa-w6-sess-reset-request-ratelimit-not-ip-scoped): mesmo
  // raciocínio do IP-scoping aplicado a /login acima — sem isto, um único IP
  // conseguia martelar o envio de e-mails de reset contra MUITAS contas/tenants
  // diferentes (cada combinação tenant+e-mail tem sua própria chave, isolada),
  // esgotando a cota de envio de e-mail da plataforma ou simplesmente
  // incomodando usuários com e-mails de reset não solicitados em massa.
  const ipRateLimitKey = `password-reset:request:ip:${clientIp(req)}`;
  try {
    await enforceRateLimit(rateLimitKey, 3, 900);
    await enforceRateLimit(ipRateLimitKey, 10, 900);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }

  // Resposta sempre genérica e 200, exista ou não a conta/tenant — nunca revela por
  // enumeração de e-mail/slug se um endereço corresponde a um usuário real (mesma
  // garantia já aplicada ao reset de admin de plataforma, Capítulo 14.3).
  const tenant = await prismaUnscoped.tenant.findUnique({ where: { slug: tenantSlug } });
  const user = tenant ? await prismaUnscoped.user.findFirst({ where: { tenantId: tenant.id, email, active: true } }) : null;
  if (tenant && user) {
    const rawToken = randomUUID();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const resetToken = await prismaUnscoped.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000),
        requestedFromIp: req.ip ?? "0.0.0.0",
      },
    });

    const appBaseUrl = await resolveAppBaseUrl();
    const resetLink = `${appBaseUrl}/redefinir-senha?token=${rawToken}`;
    // fa-w5-notif-reset-email-html-injection — `user.name`/`tenant.tradeName` são
    // dados editáveis pelo próprio usuário/tenant (cadastro/onboarding) e NUNCA
    // podem ser interpolados crus em HTML de e-mail (um nome contendo
    // `<img src=x onerror=...>` executaria no cliente de e-mail de quem abrisse o
    // reset). `resetLink` é gerado inteiramente pelo servidor (UUID aleatório via
    // `randomUUID()` + `appBaseUrl` configurado), nunca contém `&`/`<`/`>` na
    // prática, mas ainda assim passa por `escapeHtml` no atributo `href` por
    // disciplina de contexto HTML (uma URL com querystring adicional no futuro
    // poderia legitimamente conter `&`, que precisa virar `&amp;` para HTML válido).
    const safeUserName = escapeHtml(user.name);
    const safeTradeName = escapeHtml(tenant.tradeName);
    const safeResetLink = escapeHtml(resetLink);
    const emailResult = await sendPlatformEmail(
      user.email,
      "Redefinição de senha — Filitech ERP",
      `<p>Olá, ${safeUserName}.</p><p>Foi solicitada a redefinição da sua senha de acesso ao Filitech ERP (${safeTradeName}). Clique no link abaixo para continuar (válido por ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutos):</p><p><a href="${safeResetLink}">${safeResetLink}</a></p><p>Se você não solicitou esta redefinição, ignore este e-mail — sua senha continua a mesma.</p>`,
    );
    if (!emailResult.success) {
      // Nunca logar o token/link em claro — apenas o identificador do usuário e o
      // motivo da falha de entrega (mesma regra já corrigida para o reset de admin
      // de plataforma na Rodada 5), permitindo reenvio manual assistido até lá.
      logger.warn({
        userId: user.id,
        tenantId: tenant.id,
        resetTokenId: resetToken.id,
        reason: emailResult.message,
      }, "Falha ao enviar e-mail de reset de senha de usuário de tenant (token gerado, mas o link não pôde ser entregue)");
    }
  }

  return res.json({ success: true, data: { message: "Se o e-mail existir em nossa base, um link de redefinição foi enviado." }, error: null });
});

const passwordResetConfirmSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) });

authRouter.post("/auth/password-reset/confirm", async (req, res) => {
  const parsed = passwordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return zodValidationErrorResponse(res, parsed.error);
  }

  const passwordPolicy = validatePasswordPolicy(parsed.data.newPassword);
  if (!passwordPolicy.valid) {
    return res.status(400).json({ success: false, data: null, error: { code: "WEAK_PASSWORD", message: passwordPolicy.errors.join(" ") } });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const resetToken = await prismaUnscoped.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!resetToken || !resetToken.userId || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_TOKEN", message: "Token de redefinição inválido, já utilizado ou expirado." } });
  }

  const newPasswordHash = await hashPassword(parsed.data.newPassword);
  // Mesma proteção de concorrência do reset de admin de plataforma: consumação do
  // token via `updateMany` condicional (`usedAt: null`) dentro de transação — nunca
  // aplica a troca de senha "otimisticamente" antes de garantir posse exclusiva do
  // token (evita dupla redefinição por duas requisições concorrentes com o mesmo link).
  // CORREÇÃO DE AUDITORIA (fa-w5-sec-tenant-jwt-no-revocation): `tokenVersion` é
  // incrementado atomicamente (`increment: 1`) na MESMA transação da troca de senha
  // — qualquer JWT de sessão emitido antes deste reset passa a ter uma
  // `tokenVersion` desatualizada e é rejeitado por `auth.middleware.ts` na próxima
  // requisição (ou em até `TOKEN_VERSION_CACHE_TTL_SECONDS` depois, se o cache
  // Redis ainda não tiver expirado — invalidado explicitamente logo abaixo).
  const tokenConsumed = await prismaUnscoped.$transaction(async (tx) => {
    const consumption = await tx.passwordResetToken.updateMany({
      where: { id: resetToken.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumption.count === 0) return false;

    await tx.user.update({ where: { id: resetToken.userId! }, data: { passwordHash: newPasswordHash, tokenVersion: { increment: 1 } } });
    // CORREÇÃO DE AUDITORIA (fa-w6-sess-no-tenant-session-management): além de
    // `tokenVersion` (que já invalida qualquer JWT emitido antes do reset), revoga
    // explicitamente toda `ActiveSession` ainda ativa deste usuário — mantém a
    // listagem GET /auth/sessions consistente (sem "sessões fantasma" que
    // aparentam ativas mas cujo token já foi invalidado por outro mecanismo).
    await tx.activeSession.updateMany({ where: { userId: resetToken.userId!, revokedAt: null }, data: { revokedAt: new Date() } });
    return true;
  });
  if (!tokenConsumed) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_TOKEN", message: "Token de redefinição inválido, já utilizado ou expirado." } });
  }
  await invalidateUserTokenVersionCache(resetToken.userId!);

  return res.json({ success: true, data: { message: "Senha redefinida com sucesso. Faça login novamente." }, error: null });
});

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });

// CORREÇÃO DE AUDITORIA (fa-w6-sess-no-change-password-endpoint): até aqui, um
// usuário de tenant JÁ AUTENTICADO não tinha NENHUMA forma de trocar a própria
// senha sem passar pelo fluxo de "esqueci minha senha" (que depende de e-mail) —
// mesmo sabendo a senha atual. Exige a senha atual (nunca troca "às cegas" só por
// já ter uma sessão válida — mitiga o cenário de uma sessão sequestrada tentar
// travar o dono real para fora trocando a senha sem confirmar posse dela).
authRouter.post("/change-password", authMiddleware, requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return zodValidationErrorResponse(res, parsed.error);
  }

  const passwordPolicy = validatePasswordPolicy(parsed.data.newPassword);
  if (!passwordPolicy.valid) {
    return res.status(400).json({ success: false, data: null, error: { code: "WEAK_PASSWORD", message: passwordPolicy.errors.join(" ") } });
  }

  const { userId, sid } = req.session!;
  const user = await prismaUnscoped.user.findUnique({ where: { id: userId } });
  if (!user) {
    return res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message: "Sessão ausente ou inválida." } });
  }

  const currentPasswordOk = await verifyPassword(user.passwordHash, parsed.data.currentPassword);
  if (!currentPasswordOk) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Senha atual incorreta." } });
  }

  const newPasswordHash = await hashPassword(parsed.data.newPassword);
  // Mesmo padrão de /auth/password-reset/confirm: `tokenVersion` incrementado
  // atomicamente junto da troca de senha — invalida TODOS os JWTs de sessão já
  // emitidos (de qualquer dispositivo), não só a sessão atual. A sessão ATUAL
  // continua autenticada até o fim desta requisição (já passou por
  // `authMiddleware` antes de chegar aqui) — o cliente deve logar de novo.
  const currentSidHash = sid ? hashSessionId(sid) : null;
  await prismaUnscoped.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: newPasswordHash, tokenVersion: { increment: 1 } } });
    await tx.activeSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  await invalidateUserTokenVersionCache(userId);
  if (currentSidHash) {
    await invalidateUserSessionCache(currentSidHash);
  }

  return res.json({ success: true, data: { message: "Senha alterada com sucesso. Faça login novamente." }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// GERENCIAMENTO DE SESSÕES ATIVAS (fa-w6-sess-no-tenant-session-management)
// ─────────────────────────────────────────────────────────────────────────
// Espelha, para o lado tenant, o mesmo painel "Sessões ativas" já existente para
// PlatformAdminUser (Capítulo 14.4, security.api.ts no frontend do painel) — um
// usuário de tenant agora também consegue ver de quais dispositivos/IPs está
// logado e encerrar qualquer um deles remotamente (ex.: celular perdido/roubado),
// sem depender de um OWNER/suporte para forçar a troca de senha só para isso.

authRouter.get("/sessions", authMiddleware, requireAuth, async (req, res) => {
  const { userId, sid } = req.session!;
  const currentSidHash = sid ? hashSessionId(sid) : null;

  const sessions = await prismaUnscoped.activeSession.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, refreshTokenHash: true },
  });

  return res.json({
    success: true,
    data: sessions.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      // Nunca expõe `refreshTokenHash` ao cliente — só usado internamente acima
      // para marcar qual das sessões listadas é a que está fazendo esta própria
      // requisição agora.
      current: currentSidHash !== null && session.refreshTokenHash === currentSidHash,
    })),
    error: null,
  });
});

authRouter.delete("/sessions/:id", authMiddleware, requireAuth, async (req, res) => {
  const { userId } = req.session!;
  const { id } = req.params;

  // `findFirst` com `userId` na própria condição (não um `findUnique` por `id` +
  // checagem depois) — garante, em uma única consulta, que um usuário NUNCA
  // consegue revogar a sessão de outro usuário só adivinhando/enumerando o `id`
  // (UUID) de uma ActiveSession alheia.
  const session = await prismaUnscoped.activeSession.findFirst({ where: { id, userId, revokedAt: null } });
  if (!session) {
    return res.status(404).json({ success: false, data: null, error: { code: "SESSION_NOT_FOUND", message: "Sessão não encontrada ou já encerrada." } });
  }

  await prismaUnscoped.activeSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await invalidateUserSessionCache(session.refreshTokenHash);

  return res.json({ success: true, data: { revoked: true }, error: null });
});

authRouter.post("/logout-all", authMiddleware, requireAuth, async (req, res) => {
  const { userId } = req.session!;

  // Revoga TODAS as sessões ativas (lista completa de hashes ANTES do
  // `updateMany`, para poder invalidar o cache Redis de cada uma individualmente
  // — `updateMany` não devolve as linhas afetadas).
  const sessions = await prismaUnscoped.activeSession.findMany({ where: { userId, revokedAt: null }, select: { refreshTokenHash: true } });
  await prismaUnscoped.activeSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  // Defesa em profundidade: também incrementa `tokenVersion` — cobre o caso raro
  // de um token sem `sid` (emitido antes deste hardening) ainda estar em uso em
  // algum dispositivo esquecido, que a revogação de `ActiveSession` sozinha não
  // alcançaria.
  await prismaUnscoped.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  await invalidateUserTokenVersionCache(userId);
  await Promise.all(sessions.map((s) => invalidateUserSessionCache(s.refreshTokenHash)));

  return res.json({ success: true, data: { revokedCount: sessions.length }, error: null });
});

// CORREÇÃO DE AUDITORIA (fa-w6-sess-no-tenant-session-management): antes, "logout"
// era puramente client-side (o frontend só descartava o token do localStorage) —
// um token roubado antes do logout continuava 100% válido até expirar sozinho
// (até 8h). Agora revoga de fato a `ActiveSession` correspondente no servidor.
authRouter.post("/logout", authMiddleware, requireAuth, async (req, res) => {
  const { userId, sid } = req.session!;
  if (sid) {
    const sidHash = hashSessionId(sid);
    const session = await prismaUnscoped.activeSession.findFirst({ where: { userId, refreshTokenHash: sidHash, revokedAt: null } });
    if (session) {
      await prismaUnscoped.activeSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await invalidateUserSessionCache(sidHash);
    }
  }
  return res.json({ success: true, data: { loggedOut: true }, error: null });
});

// Capítulo 13.1 — qualquer usuário autenticado consegue encerrar sua PRÓPRIA sessão
// de impersonation a qualquer momento (não exige papel OWNER: o objetivo é dar ao
// lojista controle total sobre uma sessão de suporte aberta em seu nome). Idempotente:
// chamar de novo depois de já encerrada apenas confirma, sem erro.
authRouter.post("/impersonation/end", authMiddleware, requireAuth, async (req, res) => {
  const sessionId = req.session?.impersonation?.sessionId;
  if (!sessionId) {
    return res.status(409).json({ success: false, data: null, error: { code: "NOT_IMPERSONATING", message: "Esta sessão não é uma sessão de impersonation." } });
  }
  await prismaUnscoped.impersonationSession.updateMany({
    where: { id: sessionId, endedAt: null },
    data: { endedAt: new Date() },
  });
  // Reflete a revogação imediatamente no cache de curto TTL usado pelo
  // middleware de revalidação (ver auth.middleware.ts), em vez de deixar o token
  // continuar válido por até o TTL do cache expirar sozinho.
  await invalidateImpersonationSessionCache(sessionId);
  return res.json({ success: true, data: { ended: true }, error: null });
});
