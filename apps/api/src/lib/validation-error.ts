// apps/api/src/lib/validation-error.ts
// CORREÇÃO DE AUDITORIA (fa-w4-validation-error-shape-inconsistent): falhas de
// validação zod respondiam com formatos diferentes espalhados pelas rotas — algumas
// só com `error.message` (um resumo legível, mas sem apontar o campo problemático),
// outras só com `error.details` (a árvore completa do zod, sem nenhum resumo
// legível por humano), outras com os dois. Um único formato, usado de forma
// consistente: `message` sempre presente (resumo legível, para log/toast genérico)
// e `details` sempre presente (saída de `.flatten()`, para o front-end destacar o
// campo específico do formulário).
import { Response } from "express";
import { ZodError } from "zod";

export function zodValidationErrorResponse(res: Response, error: ZodError, message = "Dados inválidos."): Response {
  return res.status(400).json({
    success: false,
    data: null,
    error: { code: "VALIDATION_ERROR", message, details: error.flatten() },
  });
}
