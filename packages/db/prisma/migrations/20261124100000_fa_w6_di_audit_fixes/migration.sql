-- fa-w6-di-backup-not-pit-consistent / fa-w6-di-backup-no-restore-verification:
-- manifesto de contagem de linhas por modelo (lido dentro da transação REPEATABLE
-- READ do dump) e timestamp de verificação pós-upload (re-download + decifra +
-- confere contagem antes de marcar SUCCESS).
ALTER TABLE "database_backup_logs" ADD COLUMN "modelRowCounts" JSONB;
ALTER TABLE "database_backup_logs" ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- fa-w6-di-export-purge-no-legal-hold: expurgo automático de ZIP de exportação LGPD
-- (30 dias) nunca roda sobre um job com retenção legal marcada manualmente.
ALTER TABLE "tenant_data_export_jobs" ADD COLUMN "legalHold" BOOLEAN NOT NULL DEFAULT false;

-- fa-w6-di-lgpd-deletion-non-atomic: cursor de retomada (último Client.id já
-- anonimizado) + contador, para que um crash no meio do processamento de um tenant
-- com muitos clientes retome de onde parou em vez de reiniciar ou travar.
ALTER TABLE "data_deletion_requests" ADD COLUMN "lastProcessedClientId" TEXT;
ALTER TABLE "data_deletion_requests" ADD COLUMN "anonymizedClientCount" INTEGER NOT NULL DEFAULT 0;

-- fa-w6-di-hard-deletes-critical-entities: soft-delete de PersonalTransaction (lançamento
-- financeiro real, usado por relatórios de fatura/orçamento) em vez de DELETE físico.
ALTER TABLE "personal_transactions" ADD COLUMN "deletedAt" TIMESTAMP(3);
