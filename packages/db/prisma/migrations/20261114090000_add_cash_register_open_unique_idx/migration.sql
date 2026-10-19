-- GAP DE AUDITORIA FECHADO (Capítulo 6.7 — Abertura de Caixa): a abertura de caixa
-- fazia um `findFirst` seguido de `create` sem nenhuma garantia de atomicidade nem
-- constraint única, permitindo duas aberturas concorrentes (duplo clique, duas
-- abas, retry de rede) do mesmo operador criarem dois `CashRegister` OPEN
-- simultâneos. A checagem em código agora roda dentro de uma transação
-- Serializable (ver cash-register.routes.ts), mas um índice único PARCIAL (não
-- representável no schema.prisma, que não modela índices parciais/condicionais) dá
-- defesa em profundidade a nível de banco: mesmo um INSERT direto fora da rota
-- normal nunca deixa dois caixas OPEN do mesmo operador coexistirem.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_registers_open_per_operator_unique_idx"
  ON "cash_registers" ("tenantId", "openedById")
  WHERE "status" = 'OPEN';
