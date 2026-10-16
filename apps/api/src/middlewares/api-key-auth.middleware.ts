// apps/api/src/middlewares/api-key-auth.middleware.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 15.4 — a própria nota de auditoria do
// capítulo documentava este gap como "fica para uma iteração futura": o model
// `TenantApiKey` e a emissão self-service (`tenant-integrations.routes.ts`) já
// existiam, mas nenhuma rota jamais *consumia* de fato uma API key para autenticar
// uma requisição externa (análogo ao `requireAuth` de sessão, mas para integrações
// programáticas de terceiros — e-commerce, ERPs contábeis parceiros).
import { Request, Response, NextFunction } from "express";
import { prismaUnscoped } from "@filitech/db";
import { hashApiKey } from "../modules/platform-admin/platform-admin.routes";
import { enforceRateLimit, RateLimitExceededError } from "../lib/rate-limit";

// GAP DE AUDITORIA FECHADO: diferente de login/PIN/password-reset (todos com
// enforceRateLimit), autenticação por API key não tinha nenhum throttling por IP.
// A key em si tem entropia alta o bastante para tornar força-bruta impraticável,
// mas um limite generoso por IP é defesa em profundidade de baixo custo contra
// automação abusiva/credential-stuffing, sem impactar uso legítimo de integração.
const API_KEY_RATE_LIMIT_MAX = 120;
const API_KEY_RATE_LIMIT_WINDOW_SECONDS = 60;

// Mesma convenção declarativa de `auth.middleware.ts` (req.session), reaproveitada
// aqui para que `tenantContextMiddleware`/`tenantLockoutMiddleware` (Capítulo 7.1/2)
// funcionem sem nenhuma duplicação de lógica de blindagem multi-tenant — uma API
// key autenticada popula a MESMA sessão que uma conta de usuário populariza.
declare module "express-serve-static-core" {
  interface Request {
    apiKeyAuth?: { apiKeyId: string; scopes: string[] };
  }
}

function unauthorized(res: Response, message: string) {
  return res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message } });
}

/** Exige uma `TenantApiKey` válida, não revogada, com o escopo informado entre
 * `scopes` (ex.: "sales:read", "stock:write" — Capítulo 15.4). Popula req.session
 * com `role: "API_KEY"` para reaproveitar tenantContextMiddleware/tenantLockoutMiddleware
 * tal como uma sessão de usuário comum — nenhuma query de rota pública precisa
 * filtrar tenantId manualmente, a extensão do Prisma Client (Capítulo 7.2) cuida disso. */
export function requireApiKey(requiredScope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await enforceRateLimit(`api-key-auth:${req.ip}`, API_KEY_RATE_LIMIT_MAX, API_KEY_RATE_LIMIT_WINDOW_SECONDS);
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
      }
      throw err;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ") || !header.slice("Bearer ".length).startsWith("fltk_live_")) {
      return unauthorized(res, "Informe a API key no cabeçalho Authorization: Bearer fltk_live_...");
    }
    const rawKey = header.slice("Bearer ".length);
    const keyHash = hashApiKey(rawKey);

    const apiKey = await prismaUnscoped.tenantApiKey.findFirst({ where: { keyHash, revokedAt: null } });
    if (!apiKey) {
      return unauthorized(res, "API key inválida, inexistente ou revogada.");
    }
    if (!apiKey.scopes.includes(requiredScope)) {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: "INSUFFICIENT_SCOPE", message: `Esta API key não possui o escopo "${requiredScope}" necessário para esta operação.` },
      });
    }

    // Fire-and-forget: nunca atrasa a resposta ao parceiro por causa de um update
    // de telemetria (mesmo padrão de outros "melhor esforço" do projeto, ex.:
    // webhook de sale.completed em close-sale.service.ts).
    prismaUnscoped.tenantApiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    req.session = { tenantId: apiKey.tenantId, userId: `apikey:${apiKey.id}`, role: "API_KEY" };
    req.apiKeyAuth = { apiKeyId: apiKey.id, scopes: apiKey.scopes };
    next();
  };
}
