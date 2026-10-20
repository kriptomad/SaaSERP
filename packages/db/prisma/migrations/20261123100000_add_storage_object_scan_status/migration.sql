-- fa-w6-up-no-magic-byte-validation / fa-w6-up-presigned-size-not-reconciled /
-- fa-w6-up-missing-object-existence-check / fa-w6-up-no-malware-scanning —
-- rastreio de upload: criado PENDING no presign, só vira CLEAN depois que
-- POST /storage/uploads/finalize confirma existência real do objeto no R2
-- (HeadObject), tamanho reconciliado e assinatura binária (magic bytes)
-- compatível com o mimetype declarado.
CREATE TYPE "StorageScanStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED');

CREATE TABLE "storage_objects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "declaredSizeBytes" INTEGER NOT NULL,
    "actualSizeBytes" INTEGER,
    "scanStatus" "StorageScanStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storage_objects_storageKey_key" ON "storage_objects"("storageKey");

CREATE INDEX "storage_objects_tenantId_scanStatus_idx" ON "storage_objects"("tenantId", "scanStatus");
