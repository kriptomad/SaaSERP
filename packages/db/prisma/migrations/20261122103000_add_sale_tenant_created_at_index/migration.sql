-- fa-w5-perf-sale-date-index: vários relatórios (financial.routes.ts,
-- fator-r-calculator.service.ts, simples-nacional-das.service.ts,
-- abc-curve-report.service.ts, collection-turnover-report.service.ts) filtram
-- Sale por tenantId + intervalo de createdAt SEM filtrar por status — o índice
-- composto existente (tenantId, status, createdAt) não atende bem esse padrão de
-- leitura (status no meio do índice obriga a considerar todas as combinações de
-- status). Índice dedicado para esse padrão de acesso.
CREATE INDEX "sales_tenantId_createdAt_idx" ON "sales"("tenantId", "createdAt");
