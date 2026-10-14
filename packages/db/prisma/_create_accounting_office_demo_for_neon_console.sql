-- Cria um tenant ACCOUNTING_OFFICE de demonstração + um vínculo (AccountingEngagement)
-- já ACEITO com o tenant demo (slug '3390'), além de uma tarefa e um documento de
-- exemplo — para a aba "Escritório contábil" (/contabilidade) ter conteúdo real
-- para mostrar em reunião, em vez de aparecer vazia.
--
-- Para demonstrar os DOIS lados do fluxo ao vivo, Bruno pode logar com o MESMO
-- e-mail/senha em dois tenants diferentes (e-mail é único por tenant, não globalmente):
--   * slug 3390            -> visão do lojista/cliente contábil (concede/revoga procuração)
--   * slug contabil-3390   -> visão do escritório de contabilidade (aceita vínculo, tarefas)
--
-- Senha nos dois: mudar@1234 (mesmo hash já usado nas contas anteriores).
-- Idempotente: pode rodar de novo sem duplicar nada.

BEGIN;

-- ===== TENANT DO ESCRITÓRIO CONTÁBIL =====
INSERT INTO public.tenants (id, slug, "legalName", "tradeName", "tenantType", status, "taxRegime", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'contabil-3390',
  'Filitech Contabilidade Demo LTDA',
  'Filitech Contabilidade Demo',
  'ACCOUNTING_OFFICE',
  'ACTIVE',
  'SIMPLES_NACIONAL',
  now(),
  now()
)
ON CONFLICT (slug) DO UPDATE SET status = 'ACTIVE';

-- Perfil público do escritório (Capítulo 21.18.6).
INSERT INTO public.accounting_firm_profiles (
  id, "tenantId", "crcNumber", "responsibleAccountantName", "responsibleAccountantCrc",
  bio, "servicesOffered", "baseMonthlyFee", "isListedInMarketplace", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  t.id,
  'CRC-SP 1/123456-O',
  'Bruno Filizola',
  'CRC-SP 1/123456-O',
  'Escritório de demonstração do Filitech ERP — mostra o fluxo completo de procuração eletrônica, tarefas recorrentes e documentos oficiais.',
  ARRAY['FULL_BOOKKEEPING','TAX_FILING','PAYROLL_ESOCIAL','PERSONAL_INCOME_TAX','DOCUMENT_EXPORT_ONLY']::"AccountingEngagementScope"[],
  499.90,
  true,
  now(),
  now()
FROM public.tenants t
WHERE t.slug = 'contabil-3390'
ON CONFLICT ("tenantId") DO NOTHING;

-- Usuário OWNER do escritório (mesmo e-mail/senha das outras contas demo).
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
WHERE t.slug = 'contabil-3390'
ON CONFLICT ("tenantId", email) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", active = true;

-- ===== VÍNCULO JÁ ACEITO ENTRE O TENANT DEMO (CLIENTE) E O ESCRITÓRIO =====
INSERT INTO public.accounting_engagements (
  id, "accountingFirmTenantId", "clientTenantId", scopes, status,
  "grantedByUserId", "grantedAt", "acceptanceDeadlineAt", "acceptedByUserId", "acceptedAt"
)
SELECT
  gen_random_uuid(),
  firm.id,
  client.id,
  ARRAY['FULL_BOOKKEEPING','TAX_FILING','PAYROLL_ESOCIAL']::"AccountingEngagementScope"[],
  'ACTIVE',
  clientOwner.id,
  now(),
  now() + interval '30 days',
  firmOwner.id,
  now()
FROM public.tenants firm
JOIN public.tenants client ON client.slug = '3390'
JOIN public.users clientOwner ON clientOwner."tenantId" = client.id AND clientOwner.email = 'brunofilizola1@gmail.com'
JOIN public.users firmOwner ON firmOwner."tenantId" = firm.id AND firmOwner.email = 'brunofilizola1@gmail.com'
WHERE firm.slug = 'contabil-3390'
  AND NOT EXISTS (
    SELECT 1 FROM public.accounting_engagements e
    WHERE e."accountingFirmTenantId" = firm.id AND e."clientTenantId" = client.id
  );

-- ===== TAREFAS DE EXEMPLO (aba "Tarefas") =====
INSERT INTO public.accounting_tasks (id, "accountingFirmTenantId", "clientTenantId", "engagementId", "taskType", competencia, "dueDate", status)
SELECT gen_random_uuid(), e."accountingFirmTenantId", e."clientTenantId", e.id, 'DAS_GERACAO', to_char(now(), 'YYYY-MM'), date_trunc('month', now()) + interval '1 month' - interval '1 day', 'PENDING'
FROM public.accounting_engagements e
JOIN public.tenants firm ON firm.id = e."accountingFirmTenantId" AND firm.slug = 'contabil-3390'
JOIN public.tenants client ON client.id = e."clientTenantId" AND client.slug = '3390'
WHERE NOT EXISTS (SELECT 1 FROM public.accounting_tasks t WHERE t."engagementId" = e.id AND t."taskType" = 'DAS_GERACAO' AND t.competencia = to_char(now(), 'YYYY-MM'));

INSERT INTO public.accounting_tasks (id, "accountingFirmTenantId", "clientTenantId", "engagementId", "taskType", competencia, "dueDate", status, "completedAt")
SELECT gen_random_uuid(), e."accountingFirmTenantId", e."clientTenantId", e.id, 'DARF_GERACAO', to_char(now() - interval '1 month', 'YYYY-MM'), date_trunc('month', now()), 'DONE', now() - interval '3 days'
FROM public.accounting_engagements e
JOIN public.tenants firm ON firm.id = e."accountingFirmTenantId" AND firm.slug = 'contabil-3390'
JOIN public.tenants client ON client.id = e."clientTenantId" AND client.slug = '3390'
WHERE NOT EXISTS (SELECT 1 FROM public.accounting_tasks t WHERE t."engagementId" = e.id AND t."taskType" = 'DARF_GERACAO' AND t.competencia = to_char(now() - interval '1 month', 'YYYY-MM'));

-- ===== DOCUMENTO OFICIAL DE EXEMPLO (aba "Documentos oficiais") =====
INSERT INTO public.official_tax_documents (
  id, "tenantId", "generatedByAccountingFirmTenantId", "documentType", "layoutVersion",
  "competenciaInicio", "competenciaFim", "fileUrl", "transmissionProtocol", status, "generatedAt"
)
SELECT
  gen_random_uuid(),
  client.id,
  firm.id,
  'DAS',
  'Leiaute PGMEI 2025',
  date_trunc('month', now() - interval '1 month'),
  date_trunc('month', now()) - interval '1 day',
  'https://demo.filitecherp.com.br/docs/das-demo.pdf',
  'DEMO-PROTOCOLO-000001',
  'TRANSMITTED',
  now() - interval '2 days'
FROM public.tenants firm
JOIN public.tenants client ON client.slug = '3390'
WHERE firm.slug = 'contabil-3390'
  AND NOT EXISTS (
    SELECT 1 FROM public.official_tax_documents d
    WHERE d."tenantId" = client.id AND d."documentType" = 'DAS' AND d."transmissionProtocol" = 'DEMO-PROTOCOLO-000001'
  );

COMMIT;
