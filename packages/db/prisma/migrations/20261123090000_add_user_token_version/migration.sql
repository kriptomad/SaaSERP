-- fa-w5-sec-tenant-jwt-no-revocation: versão do token do usuário, incrementada a
-- cada troca/reset de senha para permitir revogar todos os JWTs de sessão de
-- tenant emitidos anteriormente (ver auth.middleware.ts/jwt.service.ts).
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
