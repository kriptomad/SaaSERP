// apps/api/tests/auth/auth-rbac.test.ts
// GAP DE AUDITORIA FECHADO (fa-test-auth-rbac-missing): nenhum teste real existia
// para `authMiddleware`/`requireAuth`/`tenantLockoutMiddleware` nem para a camada de
// RBAC (`RolePermission`/`RoleDefaultPermission`) — a única suíte pré-existente
// (`tenant-isolation.test.ts`) cobre isolamento de dados entre tenants, mas nunca
// exercitou token expirado, token adulterado, permissão insuficiente, tenant
// suspenso (402) ou tentativa de forjar `tenantId`. Suíte END-TO-END via
// `supertest` contra o app Express real: tokens são assinados com a MESMA chave
// privada RS256 real (`signSessionToken`, Capítulo 3.5) usada em produção — nunca
// mockamos `jsonwebtoken` nem o middleware.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prismaUnscoped } from "@filitech/db";
import { app } from "../../src/server";
import { signSessionToken } from "../../src/modules/auth/jwt.service";

interface SignupResponse {
  token: string;
  tenant: { id: string; slug: string };
  user: { id: string };
}

const STRONG_PASSWORD = "C@nar10AuthRbac#2026";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function signupTenant(prefix: string): Promise<SignupResponse> {
  const slug = uniqueSlug(prefix);
  const res = await request(app)
    .post("/auth/signup")
    .send({
      legalName: `${prefix} Canário RBAC LTDA`,
      tradeName: `${prefix} Canário RBAC`,
      slug,
      cnpj: undefined,
      tenantType: "PERSONAL",
      ownerName: `Owner ${prefix}`,
      ownerEmail: `${slug}@rbac-canario.test`,
      ownerPassword: STRONG_PASSWORD,
      termsAccepted: true,
    });
  if (res.status !== 201) {
    throw new Error(`Falha ao criar tenant de teste "${prefix}": HTTP ${res.status} — ${JSON.stringify(res.body)}`);
  }
  return res.body.data as SignupResponse;
}

describe("Autenticação/RBAC — token, permissão, tenant lockout e forjamento de tenantId", () => {
  let tenantA: SignupResponse;
  let tenantB: SignupResponse;
  let cashierUserId: string;
  let cashierToken: string;

  beforeAll(async () => {
    tenantA = await signupTenant("rbac-tenant-a");
    tenantB = await signupTenant("rbac-tenant-b");

    // Usuário de baixo privilégio criado DIRETAMENTE no banco (não via rota pública
    // de convite, que não é o alvo deste teste) para controlar deterministicamente
    // o papel/permissões sem depender de dados de seed (`RoleDefaultPermission`)
    // que podem não existir em um banco de teste recém-criado.
    const cashier = await prismaUnscoped.user.create({
      data: {
        tenantId: tenantB.tenant.id,
        name: "Operador de Caixa Canário",
        email: `${uniqueSlug("cashier")}@rbac-canario.test`,
        passwordHash: "argon2id$placeholder-nao-usado-login-via-token-direto",
        role: "CASHIER",
      },
    });
    cashierUserId = cashier.id;

    // Override explícito NEGANDO a permissão de escrita de clientes — garante um
    // 403 determinístico independente do estado de RoleDefaultPermission seedado.
    await prismaUnscoped.rolePermission.create({
      data: { tenantId: tenantB.tenant.id, userId: cashierUserId, permission: "crm:client:write", granted: false },
    });

    cashierToken = signSessionToken({ userId: cashierUserId, tenantId: tenantB.tenant.id, role: "CASHIER", tokenVersion: 0 });
  });

  afterAll(async () => {
    await prismaUnscoped.rolePermission.deleteMany({ where: { userId: cashierUserId } });
    for (const tenant of [tenantA, tenantB]) {
      if (!tenant) continue;
      await prismaUnscoped.client.deleteMany({ where: { tenantId: tenant.tenant.id } });
      await prismaUnscoped.user.deleteMany({ where: { tenantId: tenant.tenant.id } });
    }
    await prismaUnscoped.$disconnect();
  });

  it("token EXPIRADO rejeita com 401 (não derruba o servidor, apenas 'segue sem sessão')", async () => {
    const expiredToken = signSessionToken({ userId: tenantA.user.id, tenantId: tenantA.tenant.id, role: "OWNER", tokenVersion: 0 }, "-1h");
    const res = await request(app).get("/clients").set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("token ADULTERADO (assinatura corrompida) rejeita com 401", async () => {
    const validToken = signSessionToken({ userId: tenantA.user.id, tenantId: tenantA.tenant.id, role: "OWNER", tokenVersion: 0 });
    // Corrompe o último caractere da assinatura (terceiro segmento do JWT) — o
    // payload continua sintaticamente válido, só a verificação RS256 falha.
    const segments = validToken.split(".");
    const lastChar = segments[2].slice(-1);
    segments[2] = segments[2].slice(0, -1) + (lastChar === "A" ? "B" : "A");
    const tamperedToken = segments.join(".");

    const res = await request(app).get("/clients").set("Authorization", `Bearer ${tamperedToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("usuário SEM permissão (RolePermission override granted:false) rejeita com 403", async () => {
    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ name: "Cliente que o caixa não pode cadastrar" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    const created = await prismaUnscoped.client.findFirst({ where: { tenantId: tenantB.tenant.id, name: "Cliente que o caixa não pode cadastrar" } });
    expect(created).toBeNull();
  });

  it("tenant SUSPENSO bloqueia qualquer requisição autenticada com 402", async () => {
    await prismaUnscoped.tenant.update({ where: { id: tenantA.tenant.id }, data: { status: "SUSPENDED" } });
    try {
      const res = await request(app).get("/clients").set("Authorization", `Bearer ${tenantA.token}`);
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe("TENANT_LOCKED");
    } finally {
      // Restaura o estado para não vazar efeito colateral para outras suítes que
      // porventura compartilhem o mesmo banco de teste.
      await prismaUnscoped.tenant.update({ where: { id: tenantA.tenant.id }, data: { status: "ACTIVE" } });
    }
  });

  it("tentativa de forjar tenantId no BODY da requisição é ignorada — usa sempre o tenantId do token assinado", async () => {
    // O usuário autenticado pertence ao Tenant B; tenta, no corpo da requisição,
    // "se passar" pelo Tenant A incluindo um campo tenantId arbitrário.
    const ownerTokenB = signSessionToken({ userId: tenantB.user.id, tenantId: tenantB.tenant.id, role: "OWNER", tokenVersion: 0 });
    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${ownerTokenB}`)
      .send({ name: "Cliente com tenantId forjado no body", tenantId: tenantA.tenant.id });

    expect(res.status).toBe(201);
    // O registro criado pertence ao tenant REAL do token (B), nunca ao tenantId
    // forjado no body (A) — o schema zod da rota nem sequer tem um campo
    // `tenantId`, então qualquer valor enviado é descartado silenciosamente.
    expect(res.body.data.tenantId).toBe(tenantB.tenant.id);
    expect(res.body.data.tenantId).not.toBe(tenantA.tenant.id);

    const persisted = await prismaUnscoped.client.findUnique({ where: { id: res.body.data.id } });
    expect(persisted?.tenantId).toBe(tenantB.tenant.id);
  });

  it("tentativa de forjar tenantId via QUERY STRING na listagem é ignorada — resultado continua escopado ao tenant do token", async () => {
    const ownerTokenB = signSessionToken({ userId: tenantB.user.id, tenantId: tenantB.tenant.id, role: "OWNER", tokenVersion: 0 });
    const res = await request(app)
      .get("/clients")
      .query({ tenantId: tenantA.tenant.id })
      .set("Authorization", `Bearer ${ownerTokenB}`);

    expect(res.status).toBe(200);
    const returnedIds: string[] = res.body.data.map((c: { id: string; tenantId?: string }) => c.id);
    // Nenhum cliente de outro tenant aparece mesmo tentando forjar tenantId via query.
    for (const client of res.body.data as Array<{ id: string }>) {
      const row = await prismaUnscoped.client.findUnique({ where: { id: client.id } });
      expect(row?.tenantId).toBe(tenantB.tenant.id);
    }
    expect(returnedIds).toBeDefined();
  });
});
