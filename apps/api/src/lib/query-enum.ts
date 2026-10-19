// apps/api/src/lib/query-enum.ts
// CORREÇÃO DE AUDITORIA (full-audit, "fa-sweep-status-enum-cast"): dezenas de rotas
// aceitavam `req.query.status` (ou campos equivalentes) como string livre e faziam
// `status as any` direto no `where` do Prisma. Um valor fora do enum do schema não é
// uma brecha de injeção (Prisma parametriza a query), mas quebra a rota com um 500
// (PrismaClientValidationError) em vez de um 400 claro, e permite ao cliente "testar"
// valores arbitrários sem feedback. `readEnumQuery` valida contra a lista real de
// valores do enum ANTES de montar o `where`: devolve `{ ok: true, value }` (`value`
// `undefined` quando o filtro não foi informado) ou já envia a resposta 400 e devolve
// `{ ok: false }` — o chamador só precisa de um `if (!parsed.ok) return;`.
export interface EnumQueryOk<T extends string> {
  ok: true;
  value: T | undefined;
}
export interface EnumQueryFail {
  ok: false;
}

export function readEnumQuery<T extends string>(
  res: import("express").Response,
  raw: unknown,
  allowed: readonly T[],
  field: string,
): EnumQueryOk<T> | EnumQueryFail {
  if (typeof raw !== "string" || raw.length === 0) return { ok: true, value: undefined };
  if (!(allowed as readonly string[]).includes(raw)) {
    res.status(400).json({
      success: false,
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: `Valor inválido para "${field}": "${raw}". Valores aceitos: ${allowed.join(", ")}.`,
      },
    });
    return { ok: false };
  }
  return { ok: true, value: raw as T };
}

