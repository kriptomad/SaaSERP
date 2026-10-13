// apps/api/src/middlewares/tenant-context.middleware.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 7.1 (bloco "src/middlewares/tenant-context.middleware.ts").
import { Request, Response, NextFunction } from "express";
import { runWithTenantContext } from "@filitech/db";

export function tenantContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.session?.tenantId) {
    return next(); // rotas públicas (login, webhooks) seguem sem contexto de tenant
  }
  runWithTenantContext(
    { tenantId: req.session.tenantId, userId: req.session.userId, role: req.session.role },
    async () => next(),
  );
}
