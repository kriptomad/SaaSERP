# Filitech ERP — Implementação Real (a partir de `BIBLE_ENGINEERING_V2.md`)

Este repositório é a implementação de software **real e funcional** do Filitech ERP,
construída fase a fase a partir da especificação `BIBLE_ENGINEERING_V2.md` (22
capítulos). Cada arquivo de código aqui dentro cita o capítulo da Bible do qual foi
extraído ou que implementa — e quando um bug real é encontrado durante a construção
(erro de compilação, erro de validação do Prisma, etc.), ele é corrigido **nos dois
lugares**: no código real e na Bible, preservando a Bible como fonte única de verdade.

## Estrutura

```
packages/db/        → @filitech/db: schema.prisma (116 models, extraído da Bible Cap.5)
                       + blindagem multi-tenant real (Cap.7, Prisma Client Extension)
apps/api/            → @filitech/api: Express + Node 20, JWT RS256 (Cap.3.5),
                       auth (signup/login), tenant lockout HTTP 402 (Cap.2)
apps/web/            → @filitech/web: React 18 + Vite + MUI v5 (Cap.8), login/signup
                       reais contra a API (sem mocks)
infra/docker/        → docker-compose de dev local (Postgres + Redis)
deploy/              → guias e configs dos 3 alvos de deploy (railway / vercel / generic-host)
railway.toml         → deploy gerenciado via Railway
apps/web/vercel.json  → deploy do frontend via Vercel
```

## Status desta fase (Fase 0/1 — Fundação)

✅ `schema.prisma` completo (116 models) validado com `prisma validate` e `prisma generate`
   — prova real de que o Capítulo 5 inteiro da Bible é consistente.
✅ Prisma Client Extension de isolamento multi-tenant (Capítulo 7) implementada e
   verificada: todos os 106 nomes de model em `TENANT_SCOPED_MODELS` existem de fato
   no schema real (checagem automatizada, zero divergência).
✅ API Express com JWT RS256 real (chaves geradas via `apps/api/scripts/generate-jwt-keys.js`),
   argon2id para senha, signup de tenant, login, `/me`, `/health`, tenant lockout HTTP 402.
✅ Frontend React 18/Vite/MUI v5 com login/signup/dashboard reais (sem dados mockados),
   `npm run build` e `tsc -b` passam sem erros.
✅ `npm audit`: 0 vulnerabilidades (vite bumped para v6, react-router-dom para v7 por
   causa de 2 CVEs moderados/altos nas versões iniciais).
⏳ **Ainda não testado contra um Postgres real** (sem Docker/Postgres local disponível
   nesta máquina) — ver seção "Como rodar" abaixo para o próximo passo assim que houver
   um `DATABASE_URL` real (Railway/Neon/Supabase ou Docker local).
⏳ BullMQ/Redis, Stripe/Asaas webhooks, R2 object storage, WhatsApp, motor fiscal,
   WorkOrder/PDV/niche modules: ainda não implementados em código — próximas fases.

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

> Os Dockerfiles ainda não foram build-testados nesta sessão por falta de um
> daemon Docker disponível na máquina atual — revisar a primeira execução real
> em qualquer um dos 3 ambientes antes de considerar "pronto para produção".
