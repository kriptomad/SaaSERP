// apps/api/src/modules/data-portability/data-deletion-request.routes.ts
// fa-w4-lgpd-no-deletion-workflow — Direito à Eliminação (LGPD Art. 18, VI).
//
// Fluxo completo implementado aqui:
//   1. `POST /data-portability/deletion-requests` — qualquer usuário autenticado do
//      tenant pode abrir um pedido de eliminação dos seus dados pessoais, mas
//      precisa RECONFIRMAR a própria senha no corpo da requisição (mesmo padrão de
//      reautenticação usado em `modules/auth/auth.routes.ts` via `verifyPassword`) —
//      uma ação desta gravidade não pode ser disparada só por uma sessão já aberta
//      (ex.: sessão esquecida logada num computador compartilhado).
//   2. `GET /data-portability/deletion-requests` — lista os pedidos do tenant
//      (qualquer usuário autenticado pode ver o status, mas só quem tem papel OWNER
//      decide a aprovação — ver abaixo).
//   3. `POST /data-portability/deletion-requests/:id/approve` e `/reject` — GATE DE
//      APROVAÇÃO exigido pelo enunciado da correção: só um `role === "OWNER"` do
//      próprio tenant pode aprovar/rejeitar (o enunciado permite "SUPER_ADMIN OU
//      tenant-owner"; optamos por tenant-owner, não por um fluxo de
//      platform-admin/SUPER_ADMIN, porque a decisão de apagar/anonimizar dados é do
//      controlador de dados — o próprio lojista —, e não da plataforma Filitech, que
//      aqui só opera como processadora técnica).
//   4. Aprovar enfileira `data-deletion-processing.worker.ts`, que faz a
//      ANONIMIZAÇÃO (nunca o hard-delete) de verdade — ver nota de design completa em
//      `schema.prisma`, model `DataDeletionRequest`, e no próprio worker.
//
// Toda transição de estado (PENDING→APPROVED/REJECTED/PROCESSING/COMPLETED) grava uma
// linha em `TenantAuditLog` — exigência explícita da correção.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { verifyPassword } from "../auth/password.service";
import { writeTenantAuditLog } from "../../lib/tenant-audit-log";
import { dataDeletionProcessingQueue } from "../../lib/queue";

export const dataDeletionRequestRouter = Router();

function forbidden(res: Response, message: string) {
  return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message } });
}
function notFound(res: Response, message: string) {
  return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message } });
}
function validationError(res: Response, details: unknown) {
  return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details } });
}

const createSchema = z.object({
  reason: z.string().min(10, "Descreva o motivo do pedido de eliminação (mínimo 10 caracteres)."),
  password: z.string().min(1, "Confirme sua senha para solicitar a eliminação de dados."),
});

// POST /data-portability/deletion-requests — abre um pedido PENDING. Reconfirmação
// de senha obrigatória (mesma exigência de reautenticação de ações sensíveis já
// usada no fluxo de login).
dataDeletionRequestRouter.post("/data-portability/deletion-requests", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { reason, password } = parsed.data;

  const user = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { id: true, passwordHash: true } });
  if (!user) return notFound(res, "Usuário não encontrado.");

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    await writeTenantAuditLog({
      tenantId,
      userId,
      action: "DATA_DELETION_REQUEST_CREATE",
      targetType: "DataDeletionRequest",
      outcome: "DENIED",
      metadata: { reason: "INVALID_PASSWORD" },
    });
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Senha incorreta." } });
  }

  const request = await prisma.dataDeletionRequest.create({
    data: { tenantId, requestedByUserId: userId, reason, status: "PENDING" },
  });

  await writeTenantAuditLog({
    tenantId,
    userId,
    action: "DATA_DELETION_REQUEST_CREATE",
    targetType: "DataDeletionRequest",
    targetId: request.id,
    outcome: "SUCCESS",
  });

  return res.status(201).json({ success: true, data: request, error: null });
});

// GET /data-portability/deletion-requests — lista os pedidos do tenant.
dataDeletionRequestRouter.get("/data-portability/deletion-requests", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const requests = await prisma.dataDeletionRequest.findMany({ where: { tenantId }, orderBy: { requestedAt: "desc" } });
  return res.json({ success: true, data: requests, error: null });
});

async function transitionRequest(
  req: Request,
  res: Response,
  targetStatus: "APPROVED" | "REJECTED",
): Promise<Response> {
  const { tenantId, userId, role } = req.session!;
  if (role !== "OWNER") {
    await writeTenantAuditLog({
      tenantId,
      userId,
      action: `DATA_DELETION_REQUEST_${targetStatus}`,
      targetType: "DataDeletionRequest",
      targetId: req.params.id,
      outcome: "DENIED",
      metadata: { reason: "FORBIDDEN" },
    });
    return forbidden(res, "Apenas o OWNER do tenant pode aprovar/rejeitar um pedido de eliminação de dados.");
  }

  const request = await prisma.dataDeletionRequest.findFirst({ where: { id: req.params.id, tenantId } });
  if (!request) return notFound(res, "Pedido de eliminação de dados não encontrado.");
  if (request.status !== "PENDING") {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "INVALID_STATE", message: `Este pedido já está em estado "${request.status}" e não pode ser reavaliado.` },
    });
  }

  const updated = await prisma.dataDeletionRequest.update({
    where: { id: request.id },
    data: {
      status: targetStatus,
      approvedByUserId: userId,
      processedAt: targetStatus === "REJECTED" ? new Date() : null,
    },
  });

  await writeTenantAuditLog({
    tenantId,
    userId,
    action: `DATA_DELETION_REQUEST_${targetStatus}`,
    targetType: "DataDeletionRequest",
    targetId: request.id,
    outcome: "SUCCESS",
  });

  if (targetStatus === "APPROVED") {
    // Enfileira o processamento real (anonimização) — nunca executado inline no
    // request HTTP, mesmo padrão de todo outro job sob demanda deste código
    // (`data-export-generation.worker.ts` etc.).
    await dataDeletionProcessingQueue.add(
      "process-data-deletion-request",
      { requestId: request.id, tenantId },
      { attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  }

  return res.json({ success: true, data: updated, error: null });
}

// POST /data-portability/deletion-requests/:id/approve — gate de aprovação (OWNER).
dataDeletionRequestRouter.post("/data-portability/deletion-requests/:id/approve", requireAuth, async (req: Request, res: Response) => {
  return transitionRequest(req, res, "APPROVED");
});

// POST /data-portability/deletion-requests/:id/reject — gate de aprovação (OWNER).
dataDeletionRequestRouter.post("/data-portability/deletion-requests/:id/reject", requireAuth, async (req: Request, res: Response) => {
  return transitionRequest(req, res, "REJECTED");
});
