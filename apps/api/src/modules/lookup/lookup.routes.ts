// apps/api/src/modules/lookup/lookup.routes.ts
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 10) — rotas públicas (sem
// sessão) para consulta de CEP (ViaCEP) e CNPJ (BrasilAPI), usadas no onboarding
// (SignupPage) e em qualquer outro cadastro futuro que precise de autopreenchimento
// de endereço/razão social. Públicas por necessidade (o usuário ainda não tem conta
// no momento do cadastro), mas protegidas por rate limit por IP — sem isso, estas
// rotas virariam um proxy anônimo e gratuito para rastrear CNPJs/CEPs em massa às
// custas da Filitech.
import { Router } from "express";
import { enforceRateLimit, RateLimitExceededError } from "../../lib/rate-limit";
import { lookupCep, InvalidCepFormatError, CepNotFoundError, ViaCepUnavailableError } from "../../lib/viacep-client";
import { lookupCnpj, InvalidCnpjFormatError, CnpjNotFoundError, BrasilApiUnavailableError } from "../../lib/brasilapi-client";

export const lookupRouter = Router();

const LOOKUP_RATE_LIMIT_MAX = 30;
const LOOKUP_RATE_LIMIT_WINDOW_SECONDS = 60;

lookupRouter.get("/lookup/cep/:cep", async (req, res) => {
  try {
    await enforceRateLimit(`lookup:cep:${req.ip}`, LOOKUP_RATE_LIMIT_MAX, LOOKUP_RATE_LIMIT_WINDOW_SECONDS);
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
    await enforceRateLimit(`lookup:cnpj:${req.ip}`, LOOKUP_RATE_LIMIT_MAX, LOOKUP_RATE_LIMIT_WINDOW_SECONDS);
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
