// apps/api/src/lib/zod-decimal.ts
// Helper de validação monetária/quantidade: aceita string ou number do client,
// mas converte para `Prisma.Decimal` ANTES de qualquer cálculo ou persistência —
// nunca deixa um `number` (float IEEE-754) chegar a uma coluna `@db.Decimal`,
// evitando os erros de arredondamento que `z.coerce.number()` introduzia em
// valores monetários/quantidades fracionárias (ex.: 19.1 + 19.2 !== 38.3 em float).
import { Prisma } from "@filitech/db";
import { z } from "zod";

type DecimalSchemaOptions = {
  /** Exige valor estritamente positivo (> 0). Default: apenas não-negativo (>= 0). */
  positive?: boolean;
};

export function zodDecimal(options: DecimalSchemaOptions = {}) {
  return z.union([z.string(), z.number()]).transform((value, ctx) => {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor numérico inválido." });
      return z.NEVER;
    }
    if (decimal.isNaN() || !decimal.isFinite()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor numérico inválido." });
      return z.NEVER;
    }
    if (options.positive ? decimal.lte(0) : decimal.lt(0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: options.positive ? "Deve ser maior que zero." : "Não pode ser negativo." });
      return z.NEVER;
    }
    return decimal;
  });
}
