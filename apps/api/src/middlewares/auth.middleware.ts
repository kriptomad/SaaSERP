// apps/api/src/middlewares/auth.middleware.ts
// Código de integração (não extraído literalmente da Bible): conecta o JWT RS256
// descrito no Capítulo 3.5 ao contexto de tenant descrito no Capítulo 7.1,
// populando req.session a partir do Bearer token antes do tenantContextMiddleware rodar.
import { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "../modules/auth/jwt.service";

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

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(); // segue sem sessão; rotas protegidas rejeitam via requireAuth
  }

  const token = header.slice("Bearer ".length);
  try {
    const claims = verifySessionToken(token);
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
