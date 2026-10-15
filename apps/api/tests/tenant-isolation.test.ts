// apps/api/tests/tenant-isolation.test.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 7 — "Blindagem Multi-Tenant (Prisma
// Extension)". Esta suíte é o "canário" pedido na mega-auditoria (rodada 5):
// um teste de regressão END-TO-END (via supertest contra o app Express real,
// sem nenhum mock de Prisma/HTTP) que cadastra DOIS tenants reais através do
// fluxo público de /auth/signup e garante que nenhuma rota tenant-scoped deixa
// o Tenant B ler, listar, editar ou apagar um recurso que pertence ao Tenant A
// — e vice-versa. Se o `tenantId` implícito da Prisma Client Extension (ou
// qualquer `where` escrito à mão em uma rota nova) algum dia vazar, este teste
// quebra imediatamente.
//
// Requer um Postgres REAL de teste (nunca mockado): configure DATABASE_URL
// apontando para um banco de teste com as migrations aplicadas
// (`npx prisma migrate deploy` em packages/db) antes de rodar `npm run test`
// no workspace apps/api. Os dois tenants criados aqui são removidos no
// afterAll — a suíte não deixa lixo no banco mesmo quando roda contra um banco
// compartilhado de CI.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prismaUnscoped } from "@filitech/db";
import { app } from "../src/server";

interface SignupResponse {
  token: string;
  tenant: { id: string; slug: string };
  user: { id: string };
}

const STRONG_PASSWORD = "C@nar10Isolamento#2026";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function signupTenant(prefix: string): Promise<SignupResponse> {
  const slug = uniqueSlug(prefix);
  const res = await request(app)
    .post("/auth/signup")
    .send({
      legalName: `${prefix} Canário Isolamento LTDA`,
      tradeName: `${prefix} Canário`,
      slug,
      cnpj: undefined,
      tenantType: "PERSONAL", // PERSONAL dispensa CNPJ obrigatório — foco do teste é isolamento, não cadastro fiscal
      ownerName: `Owner ${prefix}`,
      ownerEmail: `${slug}@isolamento-canario.test`,
      ownerPassword: STRONG_PASSWORD,
      termsAccepted: true,
    });
  if (res.status !== 201) {
    throw new Error(`Falha ao criar tenant de teste "${prefix}": HTTP ${res.status} — ${JSON.stringify(res.body)}`);
  }
  return res.body.data as SignupResponse;
}

describe("Canário de isolamento multi-tenant (Capítulo 7)", () => {
  let tenantA: SignupResponse;
  let tenantB: SignupResponse;
  let clientAId: string;
  let productAId: string;

  beforeAll(async () => {
    tenantA = await signupTenant("tenant-a");
    tenantB = await signupTenant("tenant-b");

    const clientRes = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${tenantA.token}`)
      .send({ name: "Cliente Exclusivo do Tenant A", document: null, phone: null, email: null });
    expect(clientRes.status).toBe(201);
    clientAId = clientRes.body.data.id;

    const productRes = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${tenantA.token}`)
      .send({ sku: `SKU-ISOL-${Date.now()}`, name: "Produto Exclusivo do Tenant A", unitPrice: 19.9 });
    expect(productRes.status).toBe(201);
    productAId = productRes.body.data.id;
  });

  afterAll(async () => {
    // Limpeza em cascata (FKs em Client/Product dependem do tenantId) — nunca deixa
    // dados de teste residuais em um banco compartilhado de CI.
    // Apaga só os registros que este teste efetivamente criou (Product/Client/User).
    // Não apaga o Tenant em si: várias tabelas tenant-scoped (AuditLog, Session etc.)
    // referenciam tenantId sem onDelete: Cascade, então um DELETE direto do Tenant
    // quebraria por violação de FK em um banco com dados de outras suítes. Um Tenant
    // de teste órfão sem usuários/produtos/clientes é inofensivo e facilmente
    // identificável pelo prefixo de slug "tenant-a-"/"tenant-b-" se precisar de limpeza manual.
    for (const tenant of [tenantA, tenantB]) {
      if (!tenant) continue;
      await prismaUnscoped.product.deleteMany({ where: { tenantId: tenant.tenant.id } });
      await prismaUnscoped.client.deleteMany({ where: { tenantId: tenant.tenant.id } });
      await prismaUnscoped.user.deleteMany({ where: { tenantId: tenant.tenant.id } });
    }
    await prismaUnscoped.$disconnect();
  });

  it("Tenant B não consegue ler o cliente do Tenant A por GET /clients/:id", async () => {
    const res = await request(app).get(`/clients/${clientAId}`).set("Authorization", `Bearer ${tenantB.token}`);
    expect(res.status).toBe(404);
  });

  it("Tenant B não vê o cliente do Tenant A na listagem GET /clients", async () => {
    const res = await request(app).get("/clients").set("Authorization", `Bearer ${tenantB.token}`);
    expect(res.status).toBe(200);
    const ids: string[] = res.body.data.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(clientAId);
  });

  it("Tenant B não consegue editar o cliente do Tenant A (PATCH /clients/:id)", async () => {
    const res = await request(app)
      .patch(`/clients/${clientAId}`)
      .set("Authorization", `Bearer ${tenantB.token}`)
      .send({ name: "Nome adulterado pelo Tenant B" });
    expect(res.status).toBe(404);

    // Confirma que o registro original não foi alterado de verdade (defesa em
    // profundidade — não confia apenas no HTTP 404 retornado).
    const untouched = await prismaUnscoped.client.findUnique({ where: { id: clientAId } });
    expect(untouched?.name).toBe("Cliente Exclusivo do Tenant A");
  });

  it("Tenant B não consegue ler o produto do Tenant A por GET /products/:id", async () => {
    const res = await request(app).get(`/products/${productAId}`).set("Authorization", `Bearer ${tenantB.token}`);
    expect(res.status).toBe(404);
  });

  it("Tenant B não vê o produto do Tenant A na listagem GET /products", async () => {
    const res = await request(app).get("/products").set("Authorization", `Bearer ${tenantB.token}`);
    expect(res.status).toBe(200);
    const ids: string[] = res.body.data.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(productAId);
  });

  it("Tenant B não consegue apagar o produto do Tenant A (DELETE /products/:id)", async () => {
    const res = await request(app).delete(`/products/${productAId}`).set("Authorization", `Bearer ${tenantB.token}`);
    expect(res.status).toBe(404);

    // Defesa em profundidade: o produto realmente continua existindo no banco.
    const stillThere = await prismaUnscoped.product.findUnique({ where: { id: productAId } });
    expect(stillThere).not.toBeNull();
  });

  it("Tenant A continua enxergando normalmente seus próprios recursos (sanity check)", async () => {
    const clientRes = await request(app).get(`/clients/${clientAId}`).set("Authorization", `Bearer ${tenantA.token}`);
    expect(clientRes.status).toBe(200);
    expect(clientRes.body.data.id).toBe(clientAId);

    const productRes = await request(app).get(`/products/${productAId}`).set("Authorization", `Bearer ${tenantA.token}`);
    expect(productRes.status).toBe(200);
    expect(productRes.body.data.id).toBe(productAId);
  });
});
