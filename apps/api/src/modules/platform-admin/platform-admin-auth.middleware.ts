// apps/api/src/modules/platform-admin/platform-admin-auth.middleware.ts
// Mesmo padrão de auth.middleware.ts (tenant), aplicado ao painel do dono da
// plataforma. `req.platformAdminSession` nunca é confundido com `req.session`
// (tenant) — tipos e middlewares inteiramente separados.
import { Request, Response, NextFunction } from "express";
import { verifyPlatformAdminSessionToken } from "./platform-admin-jwt.service";

declare module "express-serve-static-core" {
  interface Request {
    platformAdminSession?: {
      platformAdminUserId: string;
      role: "SUPER_ADMIN" | "SUPPORT_AGENT" | "FINANCE_ANALYST";
    };
  }
}

export function platformAdminAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next();
  }
  const token = header.slice("Bearer ".length);
  try {
    const claims = verifyPlatformAdminSessionToken(token);
    req.platformAdminSession = { platformAdminUserId: claims.platformAdminUserId, role: claims.role };
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
