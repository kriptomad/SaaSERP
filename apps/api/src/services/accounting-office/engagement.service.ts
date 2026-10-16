// apps/api/src/services/accounting-office/engagement.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.18.3 — Fluxo de Autorização
// (Procuração Eletrônica Interna) e `assertAccountingAccess()`.
// ADAPTAÇÃO DE AUDITORIA: o pseudocódigo original do Capítulo 21.18.3 chamava
// `getCurrentTenantId()`/`runWithTenantContext()` de um módulo
// `../../lib/tenant-context` que NUNCA existiu no projeto real — o contexto
// de tenant aqui é sempre passado explicitamente como parâmetro
// (`accountingFirmTenantId`), igual ao resto do backend (nunca AsyncLocalStorage
// implícito), para não introduzir um mecanismo de contexto global paralelo ao
// já existente `req.session` (Capítulo 7.1).
import { prismaUnscoped } from "@filitech/db";

const ACCEPTANCE_WINDOW_DAYS = 30;

export class EngagementNotAcceptableError extends Error {}
export class EngagementAcceptanceExpiredError extends Error {}
export class NoActiveEngagementError extends Error {}
export class DuplicateActiveEngagementError extends Error {}
export class EngagementNotRevocableError extends Error {}

export async function grantAccountingEngagement(input: {
  clientTenantId: string;
  accountingFirmTenantId: string;
  scopes: string[];
  grantedByUserId: string;
}) {
  // CORREÇÃO DE AUDITORIA (mega-audit rodada 8): antes, nada impedia o mesmo
  // tenant-cliente de conceder DUAS procurações concorrentes (PENDING ou ACTIVE)
  // ao MESMO escritório — ex.: clique duplo no botão "Autorizar contador" criava
  // dois registros. `assertAccountingAccess()` usa `findFirst` (ordem não
  // determinística) e a trilha de auditoria ficaria fragmentada entre dois
  // vínculos para o mesmo relacionamento real. Trava em nível de aplicação +
  // índice único parcial no banco (ver migration) como defesa em profundidade
  // contra corrida entre duas requisições concorrentes.
  const existing = await prismaUnscoped.accountingEngagement.findFirst({
    where: {
      clientTenantId: input.clientTenantId,
      accountingFirmTenantId: input.accountingFirmTenantId,
      status: { in: ["PENDING_ACCOUNTANT_ACCEPTANCE", "ACTIVE"] },
    },
  });
  if (existing) {
    throw new DuplicateActiveEngagementError(
      `Já existe um vínculo ${existing.status === "ACTIVE" ? "ativo" : "pendente de aceite"} com este escritório.`,
    );
  }

  const grantedAt = new Date();
  const acceptanceDeadlineAt = new Date(grantedAt.getTime() + ACCEPTANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const engagement = await prismaUnscoped.accountingEngagement.create({
    data: {
      clientTenantId: input.clientTenantId,
      accountingFirmTenantId: input.accountingFirmTenantId,
      scopes: input.scopes as any,
      grantedByUserId: input.grantedByUserId,
      grantedAt,
      acceptanceDeadlineAt,
      status: "PENDING_ACCOUNTANT_ACCEPTANCE",
    },
  });

  await prismaUnscoped.accountingEngagementAuditEvent.create({
    data: { engagementId: engagement.id, eventType: "GRANTED", actorUserId: input.grantedByUserId },
  });

  return engagement;
}

async function expireAccountingEngagement(engagementId: string) {
  await prismaUnscoped.accountingEngagement.update({ where: { id: engagementId }, data: { status: "EXPIRED" } });
  await prismaUnscoped.accountingEngagementAuditEvent.create({
    data: { engagementId, eventType: "EXPIRED" },
  });
}

export async function acceptAccountingEngagement(engagementId: string, accountantUserId: string) {
  const engagement = await prismaUnscoped.accountingEngagement.findUniqueOrThrow({ where: { id: engagementId } });

  if (engagement.status !== "PENDING_ACCOUNTANT_ACCEPTANCE") {
    throw new EngagementNotAcceptableError(`Vínculo em status "${engagement.status}" não pode mais ser aceito.`);
  }
  if (new Date() > engagement.acceptanceDeadlineAt) {
    // Mesma regra do e-CAC real: aceite fora do prazo é tratado como expiração, não aceite tardio.
    await expireAccountingEngagement(engagementId);
    throw new EngagementAcceptanceExpiredError("Prazo de 30 dias para aceite da procuração expirou.");
  }

  const updated = await prismaUnscoped.accountingEngagement.update({
    where: { id: engagementId },
    data: { status: "ACTIVE", acceptedAt: new Date(), acceptedByUserId: accountantUserId },
  });

  await prismaUnscoped.accountingEngagementAuditEvent.create({
    data: { engagementId, eventType: "ACCEPTED", actorUserId: accountantUserId },
  });

  return updated;
}

export async function revokeAccountingEngagement(
  engagementId: string,
  actorUserId: string,
  side: "CLIENT" | "ACCOUNTANT",
  reason?: string,
) {
  // CORREÇÃO DE AUDITORIA (mega-audit rodada 8): a validação de estado revogável
  // existia SOMENTE na rota HTTP — qualquer outro chamador futuro deste serviço
  // (ex.: um worker, um script administrativo) poderia revogar um vínculo já
  // EXPIRED/REVOKED_* sem nenhuma trava, gerando eventos de auditoria
  // inconsistentes (ex.: "REVOKED_BY_CLIENT" sobre um vínculo que já estava
  // EXPIRED há meses). Movida para dentro do serviço, a fonte única da regra.
  const current = await prismaUnscoped.accountingEngagement.findUniqueOrThrow({ where: { id: engagementId } });
  if (current.status !== "ACTIVE" && current.status !== "PENDING_ACCOUNTANT_ACCEPTANCE") {
    throw new EngagementNotRevocableError(`Vínculo em status "${current.status}" não pode ser revogado.`);
  }
  const status = side === "CLIENT" ? "REVOKED_BY_CLIENT" : "REVOKED_BY_ACCOUNTANT";
  const updated = await prismaUnscoped.accountingEngagement.update({
    where: { id: engagementId },
    data: { status, revokedAt: new Date(), revokedByUserId: actorUserId, revokedReason: reason ?? null },
  });
  await prismaUnscoped.accountingEngagementAuditEvent.create({
    data: { engagementId, eventType: status, actorUserId, metadata: reason ? { reason } : undefined },
  });
  return updated;
}

/**
 * Porta única de acesso cross-tenant (Capítulo 7.4). Todo endpoint do módulo
 * de contabilidade que lê/gera documento de um tenant-cliente passa primeiro
 * por aqui, que verifica o vínculo ATIVO e registra o acesso na trilha de
 * auditoria — nunca um booleano de "contratado", sempre a checagem do estado
 * real do relacionamento.
 */
export async function assertAccountingAccess(accountingFirmTenantId: string, clientTenantId: string): Promise<void> {
  const engagement = await prismaUnscoped.accountingEngagement.findFirst({
    where: { accountingFirmTenantId, clientTenantId, status: "ACTIVE" },
  });

  if (!engagement) {
    throw new NoActiveEngagementError("Nenhuma procuração eletrônica ativa entre este escritório e o tenant-cliente informado.");
  }

  await prismaUnscoped.accountingEngagementAuditEvent.create({
    data: { engagementId: engagement.id, eventType: "CROSS_TENANT_ACCESS" },
  });
}
