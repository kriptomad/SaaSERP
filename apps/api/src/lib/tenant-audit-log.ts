// apps/api/src/lib/tenant-audit-log.ts
// fa-w4-pharmacy-prescription-no-audit / fa-w4-lgpd-portability-no-audit-log /
// fa-w4-lgpd-no-deletion-workflow — helper central para gravar em `TenantAuditLog`
// (model append-only, distinto de `AuditLog` — ver nota de design completa em
// `schema.prisma`), reaproveitando o mesmo padrão já usado para `AuditLog` em
// `modules/platform-admin/platform-admin.routes.ts` (`writeAuditLog(req, action,
// targetType, targetId, metadata)`), apenas com o ator sendo um `User` do tenant em
// vez de um `PlatformAdminUser`.
import { prismaUnscoped } from "@filitech/db";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("tenant-audit-log");

export interface WriteTenantAuditLogInput {
  tenantId: string;
  /** `null`/omitido = transição automática de sistema/worker, sem usuário disparando a ação. */
  userId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome?: "SUCCESS" | "DENIED" | "FAILED";
  metadata?: Record<string, unknown>;
}

/**
 * Grava uma linha em `TenantAuditLog`. Nunca lança — uma falha ao gravar a
 * auditoria (ex.: Postgres momentaneamente indisponível) nunca pode derrubar a
 * ação de negócio que está sendo auditada; loga e segue, mesmo princípio já usado
 * por `notifyTenant`/`dispatchUserChannels` (`modules/notifications/notify.service.ts`).
 */
export async function writeTenantAuditLog(input: WriteTenantAuditLogInput): Promise<void> {
  try {
    await prismaUnscoped.tenantAuditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        outcome: input.outcome ?? "SUCCESS",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (input.metadata ?? {}) as any,
      },
    });
  } catch (error) {
    log.error({ err: error, tenantId: input.tenantId, action: input.action, targetType: input.targetType }, "falha ao gravar tenant audit log");
  }
}
