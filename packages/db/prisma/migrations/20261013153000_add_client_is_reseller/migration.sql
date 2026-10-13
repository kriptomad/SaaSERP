-- Capítulo 4.3 — Adega/Bebidas: precificação em cascata (Preço Revenda selecionado
-- automaticamente quando o cliente é um revendedor).
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a um
-- Postgres local/shadow database para rodar `prisma migrate dev` de verdade — mesma
-- limitação documentada em 20261013152700_add_technician_commission_rule/migration.sql).
-- Aditiva: Boolean NOT NULL com DEFAULT false, não quebra nenhuma linha existente.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN "isReseller" BOOLEAN NOT NULL DEFAULT false;
