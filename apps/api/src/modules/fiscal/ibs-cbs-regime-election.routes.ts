// apps/api/src/modules/fiscal/ibs-cbs-regime-election.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.15 (b) — tela real de decisão do
// "Simples Híbrido", nunca um toggle trivial: exige janela de adesão aberta e emite
// aviso explícito de irrevogabilidade semestral. Restrita a Owner/Manager
// ("fiscal:ibs-cbs-regime:manage") — nunca Cashier/Technician, por decisão
// financeira relevante o suficiente para exigir o mesmo nível de RBAC do cadastro
// de usuários (Capítulo 2.2).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { resolveElectionWindow } from "./ibs-cbs-regime-resolver.service";

export const ibsCbsRegimeElectionRouter = Router();

async function hasManageRegimePermission(role: string, userId: string): Promise<boolean> {
  const permissionCode = "fiscal:ibs-cbs-regime:manage";
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

ibsCbsRegimeElectionRouter.get("/fiscal/ibs-cbs-regime/elections", requireAuth, async (req: Request, res: Response) => {
  const elections = await prisma.tenantIbsCbsRegimeElection.findMany({
    where: { tenantId: req.session!.tenantId },
    orderBy: { semestreReferencia: "desc" },
  });
  return res.json({ success: true, data: elections, error: null });
});

const electSchema = z.object({
  regime: z.enum(["EMBUTIDO_NO_DAS", "REGULAR_COM_CREDITO"]),
  semestreReferencia: z.string().regex(/^\d{4}-S[12]$/, "Formato esperado: AAAA-S1 ou AAAA-S2"),
});

ibsCbsRegimeElectionRouter.post("/fiscal/ibs-cbs-regime/elections", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;

  if (!(await hasManageRegimePermission(role, userId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Apenas Owner/Manager podem eleger o regime de apuração de IBS/CBS." } });
  }

  const parsed = electSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { taxRegime: true } });
  if (tenant.taxRegime !== "SIMPLES_NACIONAL") {
    return res.status(409).json({
      success: false,
      data: null,
      error: {
        code: "ELECTION_NOT_APPLICABLE",
        message: "A eleição de regime de IBS/CBS só se aplica a tenants do Simples Nacional — Lucro Presumido/Real já apuram no regime regular por definição legal.",
      },
    });
  }

  const { semestreReferencia, regime } = parsed.data;
  const { janelaAbreEm, janelaFechaEm } = resolveElectionWindow(semestreReferencia);
  const now = new Date();
  if (now < janelaAbreEm || now > janelaFechaEm) {
    return res.status(409).json({
      success: false,
      data: null,
      error: {
        code: "ELECTION_WINDOW_CLOSED",
        message: `Janela de adesão para ${semestreReferencia} é de ${janelaAbreEm.toISOString().slice(0, 10)} a ${janelaFechaEm.toISOString().slice(0, 10)}. Fora dessa janela, a eleição é irrevogável e não pode ser feita ou desfeita.`,
      },
    });
  }

  const existing = await prisma.tenantIbsCbsRegimeElection.findUnique({
    where: { tenantId_semestreReferencia: { tenantId, semestreReferencia } },
  });
  if (existing) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "ELECTION_ALREADY_MADE", message: `A eleição para ${semestreReferencia} já foi feita (${existing.regime}) e é irrevogável dentro do período.` },
    });
  }

  const election = await prisma.tenantIbsCbsRegimeElection.create({
    data: { tenantId, regime, semestreReferencia, janelaAbreEm, janelaFechaEm, eleitoPorUserId: userId },
  });

  return res.status(201).json({ success: true, data: election, error: null });
});
