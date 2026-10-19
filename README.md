# Filitech ERP — Implementação Real (a partir de `BIBLE_ENGINEERING_V2.md`)

Este repositório é a implementação de software **real e funcional** do Filitech ERP,
construída fase a fase a partir da especificação `BIBLE_ENGINEERING_V2.md` (22
capítulos). Cada arquivo de código aqui dentro cita o capítulo da Bible do qual foi
extraído ou que implementa — e quando um bug real é encontrado durante a construção
(erro de compilação, erro de validação do Prisma, etc.), ele é corrigido **nos dois
lugares**: no código real e na Bible, preservando a Bible como fonte única de verdade.

## Estrutura

```
packages/db/        → @filitech/db: schema.prisma (modelo relacional completo, extraído
                       da Bible Cap.5) + blindagem multi-tenant real via Prisma Client
                       Extension (Cap.7) + ~50 migrations versionadas
apps/api/            → @filitech/api: Express + Node 20, JWT RS256 (Cap.3.5), argon2id,
                       tenant lockout HTTP 402 (Cap.2), RBAC por papel/tenant,
                       41 módulos de domínio (ver abaixo), 22 workers BullMQ assíncronos,
                       suíte de testes real (tests/auth, billing, concurrency, stock,
                       tenant-contract, tenant-isolation)
apps/web/            → @filitech/web: React 18 + Vite + MUI v5 (Cap.8), 35 módulos de
                       frontend espelhando os módulos de backend, painel super-admin
                       (platform-admin) completo, PDV offline-first (Dexie + Service
                       Worker + Background Sync)
desktop/              → aplicativo Electron (host/user mode) com licenciamento RS256
                       offline-cacheable, IPC validado por zod, secrets via safeStorage
infra/docker/        → docker-compose de dev local (Postgres + Redis)
deploy/              → guias e configs dos 3 alvos de deploy (railway / vercel / generic-host)
railway.toml         → deploy gerenciado via Railway
apps/web/vercel.json  → deploy do frontend via Vercel
```

### Módulos de domínio implementados (`apps/api/src/modules/`)

`accounting-office`, `auth`, `billing`, `car-wash`, `cash-register`, `catalog`,
`client-records`, `clients`, `comanda`, `construction`, `data-portability`,
`financial`, `fiscal`, `hardware`, `integrations`, `licensing`, `liquor-ledger`,
`lookup`, `loyalty`, `multi-filial`, `notifications`, `online-store`, `optical`,
`pdv`, `personal-finance`, `personalization`, `pharmacy`, `platform-admin`,
`products`, `public-booking`, `purchasing`, `recipes`, `reports`, `sales`,
`scheduling`, `search`, `stock`, `storage`, `suppliers`, `support-tickets`,
`tenant`, `tires`, `users`, `work-orders`.

### Workers assíncronos (BullMQ, `apps/api/src/workers/`)

Emissão e reconciliação fiscal (`fiscal-emission`, `reconcile-stuck-fiscal-documents`,
`fetch-incoming-nfe`), geração de documentos/relatórios pesados fora do request HTTP
(`accounting-document-generation`, `report-export-generation`,
`scheduled-report-generation`), import/export de dados (`data-import-validation`,
`data-import-execution`, `data-export-generation`), backup criptografado de banco
(`encrypted-database-backup`), cobrança/dunning (`suspend-overdue-tenants`,
`personal-bill-reminders`), notificações (`whatsapp-notifications`,
`sms-notifications`, `webhook-delivery`), sincronização financeira (`pluggy-sync`),
expiração de pontos/checkouts/cancelamentos agendados, e mais.

## Status atual

✅ `schema.prisma` validado com `prisma validate`/`prisma generate`, ~50 migrations
   versionadas e aplicadas incrementalmente (nunca editadas retroativamente — ver
   `packages/db/prisma/MIGRATION_NOTES.md`).
✅ Prisma Client Extension de isolamento multi-tenant (Capítulo 7) cobrindo todos os
   models tenant-scoped, com exceção explícita e auditada dos modelos dual-tenant de
   `accounting-office` (gated por `assertAccountingAccess()`).
✅ API Express com JWT RS256, argon2id, RBAC hierárquico (Owner/Manager/Technician/
   Cashier + papéis de super-admin SUPER_ADMIN/SUPPORT_AGENT/FINANCE_ANALYST),
   tenant lockout HTTP 402, cache Redis de permissões.
✅ Frontend React 18/Vite/MUI v5 com 35 módulos espelhando o backend, PDV
   offline-first (Dexie + Service Worker + Background Sync), painel super-admin com
   modais de confirmação em ações destrutivas.
✅ App desktop Electron com licenciamento offline verificável (RS256), IPC validado
   por zod, sem segredos em texto plano, sem SSO via JWT na URL.
✅ Múltiplas rodadas de auditoria forense completa (bugs, segurança, performance,
   RBAC, lógica de negócio por nicho, pagamentos/fiscal, painel super-admin) — todas
   com achados corrigidos, commitados e propagados para `main`/`railway`/`vercel`.
✅ Suíte de testes automatizados real (`apps/api/tests/`): isolamento multi-tenant,
   FIFO/FEFO + BOM, webhooks de billing, auth/RBAC, contrato da Prisma Tenant
   Extension, concorrência de caixa/orçamento — requer Postgres/Redis acessíveis
   para rodar (`npm run db:test` / CI), ver seção "Como rodar" abaixo.
⏳ Gaps de escopo maior documentados e deliberadamente adiados (ver seção própria
   abaixo): NF-e modelo 55, contingência fiscal formal, JWT em `localStorage` no
   painel admin (arquitetural, requer refatoração maior de sessão).

## Bugs reais encontrados e corrigidos durante esta construção

1. **Enums de uma linha inválidos no Prisma** (`TicketStatus`, `TicketPriority`,
   `ChargeType`, `ChargeStatus`): `prisma validate` rejeita `enum X { A B C }` numa
   linha só — corrigido em schema.prisma e na Bible.
2. **Relações inversas faltando no `Tenant`** (Service, Appointment, RestaurantTable,
   Pet, Vehicle, etc.): resolvido rodando `prisma format`, que completa relações
   simples não-nomeadas automaticamente, conforme a própria Bible já previa no
   Capítulo 7 (nota de consistência).
3. **`createTenantScopedPrismaClient` não compilava em TypeScript estrito** com a
   schema completa de 116 models — a união discriminada de `args` fica grande demais
   para o TS provar exaustividade a partir de checagem de `operation` em runtime.
   Corrigido com cast pragmático (`as any`) documentado tanto no código real quanto
   na Bible (Capítulo 7.2), seguindo o padrão recomendado pela própria documentação
   do Prisma para extensões genéricas sobre `$allModels`.

## Gaps de compliance conhecidos (documentados, não implementados)

Os itens abaixo são gaps REAIS de escopo identificados em auditoria forense e
deliberadamente NÃO implementados nesta correção pontual — implementar qualquer um
deles do zero, sem testar contra o ambiente de homologação real da SEFAZ, seria mais
arriscado do que deixá-los explicitamente bloqueados/documentados.

1. **Emissão de NF-e modelo 55 não suportada** (`fa-fiscal-nfe55-not-implemented`):
   `emit-fiscal-document.service.ts` emite apenas NFC-e e NFS-e. Qualquer tentativa de
   emitir um documento do tipo `NFE_SAIDA` (ou qualquer tipo fora de NFCE/NFSE) é
   BLOQUEADA de forma explícita e alta (log `.error` + exceção) antes de montar
   qualquer payload — nunca um "funciona parcialmente". Implementar NF-e 55 completa
   (destinatário PJ obrigatório, duplicatas, transporte, layout próprio) é um projeto
   à parte.
2. **Sem máquina de estados de contingência fiscal formal**
   (`fa-fiscal-no-formal-contingency`): quando a SEFAZ/Focus NFe fica indisponível por
   período prolongado, o sistema hoje apenas deixa o `FiscalDocument` em `PENDING` e
   deixa o BullMQ reagendar (5 tentativas, backoff exponencial) — não há emissão em
   contingência (EPEC/offline), nem transmissão retroativa automática, nem estados
   dedicados no `FiscalDocumentStatus` para isso. Ver comentário detalhado em
   `apps/api/src/workers/fiscal-emission.worker.ts` (acima da função
   `fiscalEmissionProcessor`) para a lista completa do que falta. Requer projeto
   dedicado, com testes reais de homologação SEFAZ por UF.
3. **Token JWT/admin em `localStorage` no painel** (`fa-jwt-localstorage`,
   `fa-admin-token-localstorage`): exposto a XSS caso uma dependência de frontend
   seja comprometida; a correção correta é migrar para cookie `httpOnly`+`SameSite`
   com refresh-token rotation, o que é uma mudança arquitetural de sessão maior que
   um patch pontual — mantido como gap conhecido e documentado, não corrigido
   silenciosamente.

## Como rodar localmente

```bash
npm install
cp .env.example apps/api/.env   # ajuste DATABASE_URL para um Postgres real
node apps/api/scripts/generate-jwt-keys.js
npm run db:generate
npm run db:migrate      # requer DATABASE_URL válido
npm run api:dev         # http://localhost:3333
npm run web:dev         # http://localhost:5173
```

Se tiver Docker disponível, suba Postgres+Redis locais com:
```bash
docker compose -f infra/docker/docker-compose.dev.yml up -d
```

## Os 3 alvos de deploy

Índice e critérios de escolha em [`deploy/README.md`](deploy/README.md).

1. **Vercel** (frontend `apps/web`): [`deploy/vercel/README.md`](deploy/vercel/README.md) —
   root directory `apps/web`; `apps/web/vercel.json` cuida do build do monorepo e do rewrite de SPA.
2. **Railway** (API + worker + Postgres + Redis): [`deploy/railway/README.md`](deploy/railway/README.md) —
   `railway.toml` na raiz aponta para `apps/api/Dockerfile`.
3. **Self-host genérico** (VPS, Capítulo 3.1 da Bible): [`deploy/generic-host/README.md`](deploy/generic-host/README.md) —
   `deploy/generic-host/docker-compose.yml` sobe Postgres, Redis, API, worker, Web (Nginx) e Caddy (HTTPS opcional).

> Esta máquina de desenvolvimento não tem Docker/Postgres/Redis locais disponíveis,
> então os workers e a suíte de testes não puderam ser executados contra um banco
> real nesta sessão (apenas `tsc`, `prisma validate/generate` e `vite build`, que não
> dependem de conexão com banco). Rode `npm run db:migrate` e `npx vitest run` em
> `apps/api` contra um Postgres/Redis reais (Railway, CI, ou Docker local) antes de
> promover qualquer mudança para produção.
