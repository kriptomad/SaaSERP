// apps/api/src/modules/platform-admin/platform-admin-auth.middleware.ts
// Mesmo padrão de auth.middleware.ts (tenant), aplicado ao painel do dono da
// plataforma. `req.platformAdminSession` nunca é confundido com `req.session`
// (tenant) — tipos e middlewares inteiramente separados.
//
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 14.4 — sessões ativas revogáveis. Um JWT
// RS256 válido (assinatura/exp corretos) deixa de ser suficiente por si só: a cada
// requisição também verificamos se a `ActiveSession` correspondente ao `sid` do
// token ainda não foi revogada — sem isso, revogar uma sessão comprometida no
// painel ("Encerrar sessão") não teria nenhum efeito prático até o token expirar
// sozinho em até 4h.
import { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { prismaUnscoped as prisma } from "@filitech/db";
import { verifyPlatformAdminSessionToken } from "./platform-admin-jwt.service";

declare module "express-serve-static-core" {
  interface Request {
    platformAdminSession?: {
      platformAdminUserId: string;
      role: "SUPER_ADMIN" | "SUPPORT_AGENT" | "FINANCE_ANALYST";
      sid: string;
    };
  }
}

export function hashSessionId(sid: string): string {
  return createHash("sha256").update(sid).digest("hex");
}

export async function platformAdminAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next();
  }
  const token = header.slice("Bearer ".length);
  try {
    const claims = verifyPlatformAdminSessionToken(token);
    const activeSession = await prisma.activeSession.findUnique({
      where: { refreshTokenHash: hashSessionId(claims.sid) },
      select: { revokedAt: true },
    });
    // Sessão nunca registrada (token forjado/anterior a este hardening) ou já
    // revogada manualmente pelo próprio admin — ambos tratados como "sem sessão",
    // nunca autenticando a requisição.
    if (!activeSession || activeSession.revokedAt) {
      return next();
    }
    // Atualiza `lastSeenAt` de forma best-effort (não bloqueia a requisição em caso
    // de falha transitória de banco) — alimenta a listagem "Sessões ativas" do
    // Capítulo 14.4 com a última atividade real, não apenas o horário de login.
    prisma.activeSession
      .update({ where: { refreshTokenHash: hashSessionId(claims.sid) }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    req.platformAdminSession = { platformAdminUserId: claims.platformAdminUserId, role: claims.role, sid: claims.sid };
  } catch {
    // Token inválido/expirado: segue sem sessão, rota protegida decide o que fazer.
  }
  next();
}

export function requirePlatformAdminAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.platformAdminSession) {
    return res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message: "Sessão de administrador de plataforma ausente ou inválida." } });
  }
  next();
}

/** Restringe a apenas o papel SUPER_ADMIN — usado nas rotas mais sensíveis (ex.: catálogo fiscal global, suspensão de tenant). */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.platformAdminSession?.role !== "SUPER_ADMIN") {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Esta ação exige o papel SUPER_ADMIN." } });
  }
  next();
}
