-- Cria um Tenant de DEMONSTRAÇÃO com TODOS os módulos/nichos ativos, para o dono
-- do SaaS (Bruno) poder logar como OWNER e mostrar qualquer nicho ao vivo em
-- reuniões/visitas, sem depender de nenhum plano/billing real.
--
-- Login no app operacional normal (NÃO é o painel /platform-admin):
--   slug do tenant: 3390
--   e-mail: brunofilizola1@gmail.com
--   senha: mudar@1234 (mesmo hash argon2id já usado na conta de platform-admin)
--
-- Isso é INDEPENDENTE da conta de platform-admin (dono da plataforma, acessada em
-- /platform-admin/login) criada anteriormente — são dois sistemas de login distintos:
--   * /platform-admin/login  -> gestão da SaaS como um todo (tenants, billing, infra).
--   * /login (app normal)    -> este tenant demo, com todos os 18 nichos navegáveis.
--
-- Idempotente: pode rodar de novo sem duplicar nada.

BEGIN;

-- ===== TENANT DEMO =====
INSERT INTO public.tenants (
  id, slug, "legalName", "tradeName", "tenantType", status, "taxRegime", "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid(),
  '3390',
  'Filitech Demo LTDA',
  'Filitech Demo — Todos os Nichos',
  'BUSINESS',
  'ACTIVE',
  'SIMPLES_NACIONAL',
  now(),
  now()
)
ON CONFLICT (slug) DO UPDATE SET status = 'ACTIVE';

-- ===== ATIVA TODOS OS MÓDULOS EXISTENTES PARA ESSE TENANT =====
-- (cobre os 18 nichos + módulos transversais como FISCAL_NFCE/WHATSAPP_INTEGRATION/
-- MULTI_FILIAL automaticamente, inclusive módulos futuros que venham a ser cadastrados).
INSERT INTO public.tenant_modules (id, "tenantId", "moduleCode", active, "activatedAt")
SELECT gen_random_uuid(), t.id, m.code, true, now()
FROM public.tenants t
CROSS JOIN public.modules m
WHERE t.slug = '3390'
ON CONFLICT ("tenantId", "moduleCode") DO UPDATE SET active = true, "deactivatedAt" = NULL;

-- ===== USUÁRIO OWNER DO TENANT DEMO =====
-- Senha: mudar@1234 (mesmo hash argon2id da conta de platform-admin).
INSERT INTO public.users (id, "tenantId", name, email, "passwordHash", role, active, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  t.id,
  'Bruno Filizola',
  'brunofilizola1@gmail.com',
  '$argon2id$v=19$m=19456,t=2,p=1$c/gfmAzknMG6Ki//zGMlXQ$Xy+MRsM89cDWl+f7shYkTpLF9LUmM5Bhf/EhwzKVCgA',
  'OWNER',
  true,
  now(),
  now()
FROM public.tenants t
WHERE t.slug = '3390'
ON CONFLICT ("tenantId", email) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", active = true;

COMMIT;
