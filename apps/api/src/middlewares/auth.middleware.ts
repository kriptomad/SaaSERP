// apps/api/src/middlewares/auth.middleware.ts
// Código de integração (não extraído literalmente da Bible): conecta o JWT RS256
// descrito no Capítulo 3.5 ao contexto de tenant descrito no Capítulo 7.1,
// populando req.session a partir do Bearer token antes do tenantContextMiddleware rodar.
import { Request, Response, NextFunction } from "express";
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

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(); // segue sem sessão; rotas protegidas rejeitam via requireAuth
  }

  const token = header.slice("Bearer ".length);
  try {
    const claims = verifySessionToken(token);
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
    req.session = { tenantId: claims.tenantId, userId: claims.userId, role: claims.role, impersonation: claims.impersonation };
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
