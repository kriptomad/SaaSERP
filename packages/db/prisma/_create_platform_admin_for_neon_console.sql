-- Cria a conta de administrador da plataforma (dono do SaaS Filitech ERP).
-- IMPORTANTE: esta conta é diferente de um "Tenant/Owner" de loja — é quem acessa
-- o painel interno em /platform-admin/login (infraestrutura, marketing, tenants, etc.).
-- O campo "slug" não existe para PlatformAdminUser (slug é exclusivo de Tenant),
-- então esta conta não usa slug.
--
-- Senha: mudar@1234 (hash argon2id gerado localmente com os mesmos parâmetros
-- usados em apps/api/src/modules/auth/password.service.ts).
-- 2FA (TOTP) é obrigatório: totpConfirmedAt fica NULL de propósito — no primeiro
-- login em /platform-admin/login, o sistema vai forçar o enrollment do Google
-- Authenticator/Authy antes de liberar o acesso (Capítulo 14.2 da Bible).

INSERT INTO public.platform_admin_users (id, name, email, "passwordHash", role, active)
VALUES (
  gen_random_uuid(),
  'Bruno Filizola',
  'brunofilizola1@gmail.com',
  '$argon2id$v=19$m=19456,t=2,p=1$c/gfmAzknMG6Ki//zGMlXQ$Xy+MRsM89cDWl+f7shYkTpLF9LUmM5Bhf/EhwzKVCgA',
  'SUPER_ADMIN',
  true
)
ON CONFLICT (email) DO UPDATE SET
  "passwordHash" = EXCLUDED."passwordHash",
  role = EXCLUDED.role,
  active = true;
