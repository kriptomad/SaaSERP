-- Capítulo 20.2 — fecha o gap de auditoria em que o fan-out multicanal de
-- notificações (WhatsApp/e-mail/push) nunca disparava de verdade: não existia
-- nenhum campo de telefone em User, então o canal WhatsApp da
-- NotificationPreference não tinha para onde enviar mesmo quando marcado
-- "true". Opcional (NULLable) — preenchido pelo próprio usuário via
-- PATCH /users/me/contact; aditiva, não quebra nenhuma linha existente.
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a
-- um Postgres local/shadow database para rodar `prisma migrate dev` de
-- verdade — mesma limitação documentada em outras migrations recentes, ex.:
-- 20261016090000_add_fiscal_document_focus_nfe_emission_fields/migration.sql).

-- AlterTable
ALTER TABLE "users" ADD COLUMN "whatsappPhone" TEXT;
