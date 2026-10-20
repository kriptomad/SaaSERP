// apps/api/src/middlewares/auth.middleware.ts
// Código de integração (não extraído literalmente da Bible): conecta o JWT RS256
// descrito no Capítulo 3.5 ao contexto de tenant descrito no Capítulo 7.1,
// populando req.session a partir do Bearer token antes do tenantContextMiddleware rodar.
import { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { prismaUnscoped as prisma } from "@filitech/db";
import { verifySessionToken } from "../modules/auth/jwt.service";
import { redis } from "../lib/redis";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("auth.middleware");

declare module "express-serve-static-core" {
  interface Request {
    session?: {
      tenantId: string;
      userId: string;
      role: string;
      impersonation?: { platformAdminUserId: string; sessionId: string };
      // CORREÇÃO DE AUDITORIA (fa-w6-sess-no-tenant-session-management): `sid` em
      // claro da sessão atual (claim do JWT), usado pelas rotas de
      // auth.routes.ts (GET/DELETE /auth/sessions, POST /auth/logout) para
      // identificar/revogar a `ActiveSession` correspondente. Ausente quando o
      // token foi emitido antes deste hardening (ver SessionClaims.sid).
      sid?: string;
    };
  }
}

// GAP DE AUDITORIA FECHADO (fa-superadmin-impersonation-session-not-revalidated,
// CRÍTICO): até aqui, um token de impersonation só era validado por assinatura
// RS256/expiração do próprio JWT — encerrar a sessão (`ImpersonationSession.endedAt`,
// seja pelo tenant via POST /auth/impersonation/end, seja pelo painel via
// POST /platform-admin/impersonation-sessions/:id/end) não tinha NENHUM efeito
// prático até o JWT expirar sozinho (até 30min, `IMPERSONATION_SESSION_TTL_MINUTES`
// em platform-admin.routes.ts). Toda requisição com claim de impersonation agora
// revalida a sessão no banco, com cache Redis de TTL curto — não confia cegamente
// no JWT por até 30min, mas também não bate no Postgres a cada requisição.
const IMPERSONATION_SESSION_CACHE_TTL_SECONDS = 20;
const IMPERSONATION_SESSION_CACHE_PREFIX = "impersonation-session-status:";

function impersonationCacheKey(sessionId: string): string {
  return `${IMPERSONATION_SESSION_CACHE_PREFIX}${sessionId}`;
}

/** Deve ser chamado sempre que uma ImpersonationSession é encerrada (tenant ou painel),
 * para que a revogação tenha efeito imediato em vez de esperar o TTL do cache expirar. */
export async function invalidateImpersonationSessionCache(sessionId: string): Promise<void> {
  await redis.del(impersonationCacheKey(sessionId));
}

async function isImpersonationSessionValid(sessionId: string): Promise<boolean> {
  const cacheKey = impersonationCacheKey(sessionId);
  const cached = await redis.get(cacheKey);
  if (cached === "valid") return true;
  if (cached === "invalid") return false;

  const session = await prisma.impersonationSession.findUnique({
    where: { id: sessionId },
    select: { endedAt: true, expiresAt: true },
  });
  const isValid = session != null && session.endedAt == null && session.expiresAt.getTime() > Date.now();
  await redis.set(cacheKey, isValid ? "valid" : "invalid", "EX", IMPERSONATION_SESSION_CACHE_TTL_SECONDS);
  return isValid;
}

// CORREÇÃO DE AUDITORIA (fa-w5-sec-tenant-jwt-no-revocation): `User.tokenVersion`
// (ver schema.prisma) é a fonte da verdade de revogação — incrementado a cada
// troca/reset de senha (auth.routes.ts). Checar o valor atual no Postgres em TODA
// requisição autenticada garantiria revogação imediata, mas custaria uma consulta
// extra por requisição só para isto; como o pior caso aceitável aqui é um token
// revogado continuar válido por, no máximo, o TTL do cache (bem menor que as até 8h
// de validade natural do JWT), cacheamos o valor no Redis com TTL curto — mesmo
// trade-off já usado para `ImpersonationSession` acima.
//
// CORREÇÃO DE AUDITORIA (fa-w6-sess-deactivated-user-token-still-valid): este
// cache agora também guarda `User.active` junto com `tokenVersion` (mesma chave,
// valor serializado "`tokenVersion`|`active`") — antes, desativar um usuário
// (`users.routes.ts`, PATCH /users/:id/deactivate) só marcava `active=false` no
// banco, mas o JWT emitido antes da desativação continuava passando por este
// middleware indefinidamente (nada aqui checava `active`, só `tokenVersion`).
// Reaproveitar a MESMA chave/TTL evita uma segunda consulta/cache separada só
// para este campo.
const TOKEN_VERSION_CACHE_TTL_SECONDS = 30;
const TOKEN_VERSION_CACHE_PREFIX = "user-token-version:";

function tokenVersionCacheKey(userId: string): string {
  return `${TOKEN_VERSION_CACHE_PREFIX}${userId}`;
}

/** Deve ser chamado sempre que `User.tokenVersion` é incrementado (troca/reset de
 * senha) OU `User.active` muda (ativação/desativação), para que a revogação tenha
 * efeito assim que o cache for invalidado, em vez de esperar o TTL expirar sozinho. */
export async function invalidateUserTokenVersionCache(userId: string): Promise<void> {
  await redis.del(tokenVersionCacheKey(userId));
}

interface UserAuthState {
  tokenVersion: number;
  active: boolean;
}

async function getCurrentUserAuthState(userId: string): Promise<UserAuthState | null> {
  const cacheKey = tokenVersionCacheKey(userId);
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    const [version, activeFlag] = cached.split("|");
    return { tokenVersion: Number(version), active: activeFlag === "1" };
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true, active: true } });
  if (!user) return null;
  await redis.set(cacheKey, `${user.tokenVersion}|${user.active ? "1" : "0"}`, "EX", TOKEN_VERSION_CACHE_TTL_SECONDS);
  return { tokenVersion: user.tokenVersion, active: user.active };
}

// CORREÇÃO DE AUDITORIA (fa-w6-sess-no-tenant-session-management): mesmo padrão de
// cache com TTL curto usado acima para `ImpersonationSession`/`tokenVersion`,
// aplicado agora a `ActiveSession` (sessões de tenant, Capítulo 14.4) — sem isto, um
// JWT de sessão de tenant continuaria 100% stateless e NENHUMA das novas rotas de
// revogação (POST /auth/logout, DELETE /auth/sessions/:id, POST /auth/logout-all)
// teria efeito prático até o token expirar sozinho em até 8h.
const USER_SESSION_CACHE_TTL_SECONDS = 20;
const USER_SESSION_CACHE_PREFIX = "user-session-status:";

/** SHA-256 do `sid` em claro do JWT — mesmo valor persistido em
 * `ActiveSession.refreshTokenHash` (nunca o `sid` em claro é guardado no banco). */
export function hashSessionId(sid: string): string {
  return createHash("sha256").update(sid).digest("hex");
}

function userSessionCacheKey(sidHash: string): string {
  return `${USER_SESSION_CACHE_PREFIX}${sidHash}`;
}

/** Deve ser chamado sempre que uma `ActiveSession` de tenant é revogada (logout,
 * revogação individual ou logout-all), para que a revogação tenha efeito imediato
 * em vez de esperar o TTL do cache expirar sozinho. Recebe o HASH (já calculado),
 * nunca o `sid` em claro — as rotas que revogam sempre já têm o registro (e
 * portanto o hash) em mãos, não precisam re-hashear nada. */
export async function invalidateUserSessionCache(sidHash: string): Promise<void> {
  await redis.del(userSessionCacheKey(sidHash));
}

async function isUserSessionValid(sidHash: string): Promise<boolean> {
  const cacheKey = userSessionCacheKey(sidHash);
  const cached = await redis.get(cacheKey);
  if (cached === "valid") return true;
  if (cached === "invalid") return false;

  const session = await prisma.activeSession.findUnique({
    where: { refreshTokenHash: sidHash },
    select: { revokedAt: true },
  });
  const isValid = session != null && session.revokedAt == null;
  await redis.set(cacheKey, isValid ? "valid" : "invalid", "EX", USER_SESSION_CACHE_TTL_SECONDS);
  if (isValid) {
    // Best-effort (nunca bloqueia a requisição): atualiza `lastSeenAt` só quando o
    // cache está frio (uma vez a cada TTL, não a cada requisição) — alimenta a
    // listagem "Sessões ativas" (GET /auth/sessions) com atividade recente o
    // suficiente para ser útil, sem perder o ganho de desempenho do cache.
    prisma.activeSession.update({ where: { refreshTokenHash: sidHash }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return isValid;
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(); // segue sem sessão; rotas protegidas rejeitam via requireAuth
  }

  const token = header.slice("Bearer ".length);
  try {
    const claims = verifySessionToken(token);

    const authState = await getCurrentUserAuthState(claims.userId);
    if (authState === null || authState.tokenVersion !== claims.tokenVersion) {
      logger.warn(
        { userId: claims.userId, tenantId: claims.tenantId, tokenVersion: claims.tokenVersion, currentTokenVersion: authState?.tokenVersion ?? null },
        "Token de sessão com tokenVersion desatualizada (senha trocada/redefinida após a emissão) ou usuário inexistente — requisição rejeitada",
      );
      return next(); // segue sem sessão; rota protegida responde 401
    }
    if (!authState.active) {
      logger.warn(
        { userId: claims.userId, tenantId: claims.tenantId },
        "Token de sessão de usuário desativado (User.active=false) — requisição rejeitada",
      );
      return next(); // segue sem sessão; rota protegida responde 401
    }

    if (claims.impersonation) {
      const valid = await isImpersonationSessionValid(claims.impersonation.sessionId);
      if (!valid) {
        logger.warn(
          { impersonationSessionId: claims.impersonation.sessionId, platformAdminUserId: claims.impersonation.platformAdminUserId, tenantId: claims.tenantId },
          "Tentativa de reuso de token de impersonation com sessão encerrada/expirada/inexistente — requisição rejeitada",
        );
        return next(); // segue sem sessão; rota protegida responde 401
      }
    }

    // CORREÇÃO DE AUDITORIA (fa-w6-sess-no-tenant-session-management): quando o
    // token carrega `sid` (sessão de tenant criada a partir desta rodada), a
    // `ActiveSession` correspondente precisa ainda existir e não estar revogada —
    // sem isto, POST /auth/logout, DELETE /auth/sessions/:id e POST
    // /auth/logout-all não teriam nenhum efeito prático sobre o token já emitido.
    // Tokens sem `sid` (emitidos antes deste hardening, ou de impersonation) não
    // passam por esta checagem — continuam dependendo só de tokenVersion/exp.
    if (claims.sid) {
      const sidHash = hashSessionId(claims.sid);
      const sessionValid = await isUserSessionValid(sidHash);
      if (!sessionValid) {
        logger.warn(
          { userId: claims.userId, tenantId: claims.tenantId },
          "Tentativa de reuso de token de sessão de tenant já revogado (logout/revogação individual/logout-all) — requisição rejeitada",
        );
        return next(); // segue sem sessão; rota protegida responde 401
      }
    }

    req.session = { tenantId: claims.tenantId, userId: claims.userId, role: claims.role, impersonation: claims.impersonation, sid: claims.sid };
  } catch {
    // Token inválido/expirado: segue sem sessão, rota protegida decide o que fazer.
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session) {
    return res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message: "Sessão ausente ou inválida." } });
  }
  next();
}

// GAP DE AUDITORIA FECHADO (fa-superadmin-impersonation-actions-not-audited): o JWT
// de impersonation sempre carregou `platformAdminUserId`/`sessionId`, mas NENHUMA
// mutação feita pelo lado tenant-facing (vendas, financeiro, estoque, etc.) deixava
// qualquer rastro de que o operador real era um admin da plataforma — a ação
// aparecia 100% como se tivesse sido o próprio OWNER impersonado, escondendo o
// operador real. Não existe (nem seria viável adicionar manualmente, módulo por
// módulo, neste momento) um hook central de auditoria de mutações de tenant —
// este middleware é esse hook: montado globalmente logo após `authMiddleware`,
// grava uma linha em `AuditLog` (o mesmo modelo append-only já usado pelo painel
// de plataforma, reaproveitando `isImpersonated`/`metadata` já existentes no
// schema) para TODA requisição de escrita (POST/PUT/PATCH/DELETE) feita sob
// `req.session.impersonation`, com o operador real, a sessão, o tenant afetado e
// o resultado (status HTTP) — sem precisar instrumentar cada rota individualmente.
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function impersonationAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  const impersonation = req.session?.impersonation;
  if (!impersonation || !MUTATING_METHODS.has(req.method)) {
    return next();
  }
  const tenantId = req.session!.tenantId;
  const impersonatedUserId = req.session!.userId;
  res.once("finish", () => {
    prisma.auditLog
      .create({
        data: {
          platformAdminUserId: impersonation.platformAdminUserId,
          action: `IMPERSONATED_MUTATION_${req.method}`,
          targetType: "TenantMutation",
          targetId: tenantId,
          isImpersonated: true,
          metadata: {
            impersonationSessionId: impersonation.sessionId,
            impersonatedUserId,
            tenantId,
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
          } as any,
        },
      })
      .catch((err) => logger.error({ err, impersonationSessionId: impersonation.sessionId, path: req.originalUrl }, "Falha ao gravar audit log de mutação sob impersonation"));
  });
  next();
}
