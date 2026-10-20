// apps/api/src/middlewares/request-id.middleware.ts
// Fonte: fa-w4-obs-no-request-id — todo request-id/trace-id consistente por requisição
// HTTP. Aceita um `x-request-id` já vindo de um proxy/cliente upstream (ex.: Railway,
// um API gateway de parceiro chamando `publicApiRouter`, ou o próprio frontend
// propagando o id de uma chamada anterior para correlacionar uma cadeia de
// requisições) — e gera um novo via `crypto.randomUUID()` (nativo do Node, sem
// dependência nova) quando nenhum é informado. Precisa ser o PRIMEIRO middleware da
// cadeia (ver server.ts) para que toda requisição — inclusive webhooks montados
// antes do `express.json()` global — já tenha `req.requestId`/`req.log` disponíveis.
import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { createRequestLogger } from "../lib/logger";
import type pino from "pino";

const REQUEST_ID_HEADER = "x-request-id";

declare module "express-serve-static-core" {
  interface Request {
    /** Id único desta requisição (recebido via header `x-request-id` ou gerado). */
    requestId: string;
    /** Logger (Pino) já com `requestId` amarrado — usar em vez do `logger`/
     * `createModuleLogger` cru dentro de qualquer handler HTTP, para que toda linha
     * de log daquela requisição seja correlacionável no agregador de logs. */
    log: pino.Logger;
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

  req.requestId = requestId;
  req.log = createRequestLogger(requestId);
  // Sempre devolve o id no response — tanto o que recebemos quanto o que geramos —
  // para que o cliente (frontend, integração de parceiro, suporte) possa citá-lo ao
  // reportar um problema e o time de operação localizar os logs correspondentes.
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
