// apps/api/src/modules/suppliers/suppliers.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 5 (schema `Supplier`) — GAP DE AUDITORIA
// ENCONTRADO E CORRIGIDO: `Supplier` existe no schema desde o início (referenciado
// por `Product.supplierId`, `AccountPayable.supplierId`, `PurchaseOrder.supplierId`,
// Capítulo 17.8), e as permissões RBAC "crm:supplier:read"/"crm:supplier:write" já
// estavam seedadas, mas nenhuma rota REST jamais existiu — o cadastro de produto
// (Capítulo 5/8.3) não tinha como vincular um fornecedor real por API.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const suppliersRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

suppliersRouter.get("/suppliers", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:supplier:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar fornecedores." } });
  }

  const search = typeof req.query.search === "string" ? req.query.search : null;
  const suppliers = await prisma.supplier.findMany({
    where: {
      tenantId,
      ...(search
        ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { document: { contains: search } }] }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 50,
  });

  return res.json({ success: true, data: suppliers, error: null });
});

suppliersRouter.get("/suppliers/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:supplier:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar fornecedores." } });
  }
  const supplier = await prisma.supplier.findFirst({ where: { id: req.params.id, tenantId } });
  if (!supplier) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Fornecedor não encontrado." } });
  }
  return res.json({ success: true, data: supplier, error: null });
});

const createSupplierSchema = z.object({
  name: z.string().min(2),
  document: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
});

suppliersRouter.post("/suppliers", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:supplier:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite cadastrar fornecedores." } });
  }

  const parsed = createSupplierSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  if (input.document) {
    const existing = await prisma.supplier.findFirst({ where: { tenantId, document: input.document } });
    if (existing) {
      return res.status(409).json({ success: false, data: null, error: { code: "DOCUMENT_TAKEN", message: "Já existe um fornecedor com este CPF/CNPJ." } });
    }
  }

  const supplier = await prisma.supplier.create({
    data: {
      tenantId,
      name: input.name,
      document: input.document ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
    },
  });

  return res.status(201).json({ success: true, data: supplier, error: null });
});

const updateSupplierSchema = createSupplierSchema.partial();

suppliersRouter.patch("/suppliers/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:supplier:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite editar fornecedores." } });
  }

  const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Fornecedor não encontrado." } });
  }

  const parsed = updateSupplierSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const supplier = await prisma.supplier.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.document !== undefined ? { document: input.document } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
    },
  });

  return res.json({ success: true, data: supplier, error: null });
});
