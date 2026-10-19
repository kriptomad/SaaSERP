// apps/api/src/modules/lookup/lookup.routes.ts
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 10) — rotas públicas (sem
// sessão) para consulta de CEP (ViaCEP) e CNPJ (BrasilAPI), usadas no onboarding
// (SignupPage) e em qualquer outro cadastro futuro que precise de autopreenchimento
// de endereço/razão social. Públicas por necessidade (o usuário ainda não tem conta
// no momento do cadastro), mas protegidas por rate limit por IP — sem isso, estas
// rotas virariam um proxy anônimo e gratuito para rastrear CNPJs/CEPs em massa às
// custas da Filitech.
import { Request, Router } from "express";
import { enforceRateLimit, RateLimitExceededError } from "../../lib/rate-limit";
import { lookupCep, InvalidCepFormatError, CepNotFoundError, ViaCepUnavailableError } from "../../lib/viacep-client";
import { lookupCnpj, InvalidCnpjFormatError, CnpjNotFoundError, BrasilApiUnavailableError } from "../../lib/brasilapi-client";
import { verifySessionToken } from "../auth/jwt.service";

export const lookupRouter = Router();

const LOOKUP_RATE_LIMIT_MAX = 30;
const LOOKUP_RATE_LIMIT_WINDOW_SECONDS = 60;

// GAP DE AUDITORIA FECHADO: a chave de rate limit era SÓ o IP — qualquer IP
// compartilhado (NAT de operadora móvel, proxy corporativo) fazia um único
// usuário legítimo esgotar o balde para todos os outros atrás do mesmo IP, sem
// nenhum isolamento por tenant. Este router é montado ANTES de `authMiddleware`
// (ver server.ts, usado também no onboarding pré-login), então nunca há
// `req.session`; aqui tentamos, best-effort e sem nunca lançar, extrair um
// `tenantId` de um JWT eventualmente presente no header (ex.: uso futuro deste
// mesmo endpoint por uma tela já autenticada) para também escopar por tenant
// quando essa informação estiver disponível — cai de volta para IP puro quando não.
function resolveOptionalTenantId(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  try {
    return verifySessionToken(header.slice("Bearer ".length)).tenantId;
  } catch {
    return undefined;
  }
}

lookupRouter.get("/lookup/cep/:cep", async (req, res) => {
  try {
    const tenantId = resolveOptionalTenantId(req);
    await enforceRateLimit(`lookup:cep:${tenantId ?? "anon"}:${req.ip}`, LOOKUP_RATE_LIMIT_MAX, LOOKUP_RATE_LIMIT_WINDOW_SECONDS);
    const address = await lookupCep(req.params.cep);
    return res.json({ success: true, data: address, error: null });
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    if (err instanceof InvalidCepFormatError) {
      return res.status(400).json({ success: false, data: null, error: { code: "INVALID_CEP", message: err.message } });
    }
    if (err instanceof CepNotFoundError) {
      return res.status(404).json({ success: false, data: null, error: { code: "CEP_NOT_FOUND", message: err.message } });
    }
    if (err instanceof ViaCepUnavailableError) {
      return res.status(502).json({ success: false, data: null, error: { code: "VIACEP_UNAVAILABLE", message: err.message } });
    }
    throw err;
  }
});

lookupRouter.get("/lookup/cnpj/:cnpj", async (req, res) => {
  try {
    const tenantId = resolveOptionalTenantId(req);
    await enforceRateLimit(`lookup:cnpj:${tenantId ?? "anon"}:${req.ip}`, LOOKUP_RATE_LIMIT_MAX, LOOKUP_RATE_LIMIT_WINDOW_SECONDS);
    const data = await lookupCnpj(req.params.cnpj);
    return res.json({ success: true, data, error: null });
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    if (err instanceof InvalidCnpjFormatError) {
      return res.status(400).json({ success: false, data: null, error: { code: "INVALID_CNPJ", message: err.message } });
    }
    if (err instanceof CnpjNotFoundError) {
      return res.status(404).json({ success: false, data: null, error: { code: "CNPJ_NOT_FOUND", message: err.message } });
    }
    if (err instanceof BrasilApiUnavailableError) {
      return res.status(502).json({ success: false, data: null, error: { code: "BRASILAPI_UNAVAILABLE", message: err.message } });
    }
    throw err;
  }
});
