-- Auditoria: o enrollment de TOTP (Capítulo 14.2) permitia re-roll do segredo sem
-- nonce/invalidação do enrollment pendente anterior. Estas colunas suportam um nonce
-- de enrollment com expiração curta, reemitido (e o anterior invalidado) a cada
-- chamada de /2fa/enroll.
ALTER TABLE "platform_admin_users" ADD COLUMN "totpEnrollNonce" TEXT;
ALTER TABLE "platform_admin_users" ADD COLUMN "totpEnrollNonceExpiresAt" TIMESTAMP(3);
