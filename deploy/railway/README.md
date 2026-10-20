# Deploy no Railway (API + Postgres + Redis gerenciados)

Hospeda `apps/api` (Express/Prisma), o worker BullMQ, Postgres 15 e Redis. O frontend vai para a Vercel (`../vercel/README.md`).

## Arquivos

| Arquivo | Função |
|---|---|
| `/railway.toml` (raiz) | **Ativo.** Config-as-code da API: build via `apps/api/Dockerfile`, healthcheck `/health`. O Railway só procura aqui — não mova. |
| `deploy/railway/railway.worker.toml` | Config do serviço *worker* (mesmo build, sem healthcheck). Apontado manualmente nas Settings do serviço worker. |
| `apps/api/Dockerfile` | Build multi-stage; runtime distroless (`ENTRYPOINT node`, `CMD apps/api/dist/start.cjs`). |

> O `railway.toml` **não define `startCommand`** de propósito: a imagem é distroless e o entrypoint já é `node`. O mesmo vale para `dockerfilePath`: o contexto de build é a raiz do monorepo.

## Passo a passo

### 1. Projeto e repositório
1. https://railway.com/new → **Deploy from GitHub repo** → autorize o app do Railway e escolha o repositório do Filitech.
2. O Railway cria um serviço a partir do repo. Renomeie para `api`. Não defina *Root Directory* (deixe a raiz, onde está o `railway.toml`).
3. Em **Settings → Networking**, clique **Generate Domain** (ou adicione domínio próprio, ex. `api.seudominio.com`, criando o CNAME indicado).

### 2. Provisionar Postgres e Redis
1. No canvas do projeto: **+ New → Database → Add PostgreSQL** (Postgres gerenciado; confirme que a versão é 15+).
2. **+ New → Database → Add Redis**.
3. No serviço `api` → **Variables**, crie referências (não copie valores):
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `REDIS_URL` = `${{Redis.REDIS_URL}}`

   (Os nomes `Postgres`/`Redis` são os nomes dos serviços no canvas; ajuste se renomeou.) A API usa a rede privada do Railway (`*.railway.internal`), sem custo de egress.

### 3. Variáveis de ambiente da API
Lista exaustiva do que `apps/api/src` lê via `process.env` (auditado por busca):

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | Postgres (Prisma). Referência `${{Postgres.DATABASE_URL}}`. |
| `REDIS_URL` | sim | Redis (filas BullMQ + cache). Default local `redis://localhost:6379` não serve em produção. |
| `PORT` | auto | Injetada pelo Railway; a API escuta nela (default 3333). Não defina. |
| `CORS_ORIGIN` | sim | Origens permitidas separadas por vírgula, sem barra final. Ex.: `https://app.seudominio.com,https://filitech.vercel.app`. Sem ela o CORS fica `*`. |
| `JWT_PRIVATE_KEY` | sim* | PEM RS256 privado, conteúdo inteiro (ver abaixo). |
| `JWT_PUBLIC_KEY` | sim* | PEM RS256 público. |
| `INTEGRATION_CREDENTIALS_MASTER_KEY` | sim | KEK de 32 bytes em base64 que cifra credenciais de integração (`openssl rand -base64 32`). **Guarde-a: perdê-la torna as credenciais ilegíveis.** |
| `STRIPE_SECRET_KEY` | se usar Stripe | Chave secreta Stripe (`sk_live_...`). |
| `STRIPE_WEBHOOK_SECRET` | se usar Stripe | Segredo do endpoint de webhook (`whsec_...`). |
| `ASAAS_API_KEY` | se usar Asaas | Token da API Asaas. |
| `ASAAS_BASE_URL` | não | Default `https://www.asaas.com/api/v3` (sandbox: `https://sandbox.asaas.com/api/v3`). |
| `ASAAS_WEBHOOK_TOKEN` | se usar Asaas | Token que o Asaas envia no webhook. |
| `NODE_ENV` | recomendado | `production` (já definido na imagem). |
| `APP_ROLE` | só no worker | `worker` faz o `start.cjs` iniciar o worker BullMQ em vez da API. |

\* O código aceita `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (PEM) **ou** `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` (arquivo). No Railway não há arquivos secretos, então use o PEM em variável. Gere o par:

```bash
node apps/api/scripts/generate-jwt-keys.js   # cria apps/api/keys/jwt-private.pem e jwt-public.pem (gitignored)
```
No Railway (Raw Editor das Variables) cole o conteúdo multilinha dos `.pem` ou, em uma linha, com `\n` literais (a API converte `\n` em quebra de linha).

Observação: `R2_*`, `WHATSAPP_*` e `PLUGGY_*` do `.env.example` raiz **não são lidas** por `process.env` hoje — credenciais de integração são cadastradas no banco (`IntegrationCredential`, cifradas pela KEK acima) pelo painel.

### 4. Migrações do banco (`prisma migrate deploy`) — automático

**fa-w5-boot-migration-not-applied (corrigido):** o schema vive em `packages/db/prisma` e as migrations em `packages/db/prisma/migrations` (já existe `0_init`). Diferente de versões anteriores deste guia, você **não precisa mais rodar `prisma migrate deploy` manualmente** a cada deploy: `apps/api/dist/start.cjs` (o launcher que o CMD da imagem invoca) roda `prisma migrate deploy` **sincronamente, antes de iniciar o Express** — nenhuma réplica da API aceita tráfego (nem o healthcheck `/health` fica verde) enquanto o schema não estiver em dia. O worker (`APP_ROLE=worker`) **não** roda esse passo (evita toda réplica de worker competir pela mesma migration).

Como o Railway não tem um "release phase"/pre-deploy hook equivalente ao do Heroku (confirmado: `railway.toml` só aceita `[build]`/`[deploy]`, sem campo de comando pré-boot), o gate fica embutido no próprio processo da API. Isso é seguro mesmo com múltiplas réplicas da API subindo ao mesmo tempo: `prisma migrate deploy` adquire um **advisory lock do Postgres** internamente, então só uma réplica aplica as migrations pendentes por vez — as demais aguardam o lock e, ao adquiri-lo, não encontram mais nada pendente (no-op). `start.cjs` ainda faz 3 tentativas com backoff (5s/10s/15s) antes de desistir e abortar o boot com `process.exit(1)`, cobrindo o caso de uma réplica perder a espera do lock por timeout.

Se precisar aplicar uma migration manualmente mesmo assim (ex.: diagnosticar um estado divergente), ainda é possível rodar da sua máquina contra a URL pública:
```bash
# Serviço Postgres → Variables → copie DATABASE_PUBLIC_URL
# PowerShell: $env:DATABASE_URL="<DATABASE_PUBLIC_URL>"
export DATABASE_URL="<DATABASE_PUBLIC_URL>"
npm install
npm run db:deploy        # = prisma migrate deploy (workspace @filitech/db)
```

### 5. Healthcheck
`railway.toml` define `healthcheckPath = "/health"` (timeout 60 s). A rota executa `SELECT 1` e devolve `200 {"status":"ok"}` ou `503` se o banco estiver fora — o Railway só promove o deploy novo quando recebe 200. Teste: `curl https://api.seudominio.com/health`.

### 6. Worker BullMQ (filas WhatsApp, fiscal, relatórios)
1. **+ New → GitHub Repo** (mesmo repositório) → renomeie para `worker`.
2. Variables: as mesmas do `api` (use *Shared Variables* ou referências) **mais** `APP_ROLE=worker`.
3. Settings → **Config-as-code → Railway Config File Path**: `/deploy/railway/railway.worker.toml` (sem healthcheck, pois não há HTTP).
4. Não gere domínio público para o worker.

### 7. Deploys automáticos
Cada push na branch configurada (Settings → Source → Branch) dispara build. `watchPatterns` do `railway.toml` limita rebuilds a mudanças em `apps/api`, `packages/db` e lockfile. Para PRs, habilite **PR Environments** em Settings → Environments.

### 8. Conectar o frontend
Na Vercel defina `VITE_API_BASE_URL=https://api.seudominio.com` e inclua a origem do frontend em `CORS_ORIGIN` na API.

## Troubleshooting
- Crash no boot: verifique as variáveis obrigatórias de produção listadas acima — `apps/api/src/lib/env-validation.ts` loga TODAS as que estiverem ausentes/inválidas de uma vez (não só a primeira) antes de `process.exit(1)`.
- Boot trava em "prisma migrate deploy — tentativa N/3": `DATABASE_URL` aponta para o serviço errado, está inacessível, ou há uma migration com erro — veja o log completo do comando (impresso com `stdio: "inherit"`).
- Healthcheck 503: banco inacessível (ver item acima) — migrations em si não ficam mais pendentes nesse ponto, pois a API só começa a aceitar tráfego depois de `prisma migrate deploy` ter sido bem-sucedido no boot (`fa-w5-boot-migration-not-applied`).
- `INTEGRATION_CREDENTIALS_MASTER_KEY não configurada`: variável ausente.
