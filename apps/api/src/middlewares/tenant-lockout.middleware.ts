// apps/api/src/middlewares/tenant-lockout.middleware.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2 — Tenant Lockout: middleware global que
// intercepta HTTP 402 se o lojista não pagar, bloqueando o sistema e exigindo regularização.
import { Request, Response, NextFunction } from "express";
import { prismaUnscoped } from "@filitech/db";

/// Avalia se o tenant está bloqueado por inadimplência (SUSPENDED/CANCELLED, ou
/// PAST_DUE já fora do grace period) — extraída para ser reaproveitada fora deste
/// middleware, por exemplo pelo módulo de Licença Mestra (Capítulo 2.10), que
/// consulta a MESMA regra de negócio antes de emitir/renovar o token offline, sem
/// duplicar a lógica de precedência do Tenant Lockout.
export function isTenantLocked(tenant: { status: string; gracePeriodEndsAt: Date | null }): boolean {
  const inGracePeriod = tenant.status === "PAST_DUE" && Boolean(tenant.gracePeriodEndsAt) && tenant.gracePeriodEndsAt! > new Date();
  return (tenant.status === "SUSPENDED" || tenant.status === "CANCELLED") || (tenant.status === "PAST_DUE" && !inGracePeriod);
}

export async function tenantLockoutMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.tenantId) {
    return next();
  }

  const tenant = await prismaUnscoped.tenant.findUnique({
    where: { id: req.session.tenantId },
    select: { status: true, gracePeriodEndsAt: true },
  });

  if (!tenant) {
    return res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message: "Tenant não encontrado." } });
  }

  if (isTenantLocked(tenant)) {
    return res.status(402).json({
      success: false, data: null, error: {
        code: "TENANT_LOCKED",
        message: "Assinatura pendente de pagamento. Regularize para continuar usando o sistema.",
        tenantStatus: tenant.status,
      },
    });
  }

  next();
}
