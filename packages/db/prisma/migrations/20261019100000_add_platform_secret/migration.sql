-- GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: o model `PlatformSecret` existia em
-- schema.prisma (aba Administração → Infraestrutura) mas nunca teve uma migration
-- gerada — toda outra tabela do banco existia, só esta faltava, quebrando
-- `getPlatformSecret()`/CORS em toda request (P2021: table does not exist).
-- CreateTable
CREATE TABLE "platform_secrets" (
    "key" TEXT NOT NULL,
    "encryptedPayload" BYTEA NOT NULL,
    "encryptionKeyId" TEXT NOT NULL,
    "updatedByPlatformAdminUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_secrets_pkey" PRIMARY KEY ("key")
);
