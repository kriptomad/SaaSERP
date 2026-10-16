-- Mega-audit rodada 8: índice único PARCIAL (não representável no schema.prisma,
-- que não modela índices parciais/condicionais) para impedir, a nível de banco, dois
-- vínculos PENDING_ACCOUNTANT_ACCEPTANCE/ACTIVE concorrentes entre o mesmo
-- tenant-cliente e o mesmo escritório — defesa em profundidade além da checagem já
-- feita em grantAccountingEngagement() (engagement.service.ts), que cobre a corrida
-- entre duas requisições concorrentes de concessão que passariam ambas pela checagem
-- em memória antes de qualquer uma commitar.
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_engagements_active_pair_unique_idx"
  ON "accounting_engagements" ("clientTenantId", "accountingFirmTenantId")
  WHERE "status" IN ('PENDING_ACCOUNTANT_ACCEPTANCE', 'ACTIVE');
