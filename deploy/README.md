# Deploy — três destinos segregados

Cada pasta é um alvo independente e tem seu próprio guia. Os arquivos que a plataforma exige em local fixo continuam onde ela os procura (`/railway.toml`, `apps/web/vercel.json`); `deploy/` guarda guias e configs adicionais.

| Destino | Hospeda | Guia | Quando usar |
|---|---|---|---|
| **Railway** | `apps/api` + worker + Postgres + Redis gerenciados | [`railway/README.md`](railway/README.md) | Caminho mais rápido para o backend gerenciado: sem servidor para operar, deploy por push, banco/Redis em 2 cliques. Custo cresce com uso. |
| **Vercel** | `apps/web` (SPA estática) | [`vercel/README.md`](vercel/README.md) | Frontend com CDN global e preview por PR. Combine com Railway **ou** com a API self-host. |
| **Generic host** | Tudo (web, api, worker, Postgres, Redis, HTTPS) via Docker Compose | [`generic-host/README.md`](generic-host/README.md) | Controle total e menor custo em escala (Hetzner/DigitalOcean). Exige operar backups, atualizações e segurança do servidor. |

Combinações típicas: **Vercel + Railway** (início/MVP) · **Generic host sozinho** (custo/controle) · Vercel + API no generic host.

## Branches de deploy (repositório `kriptomad/SaaSERP`)
`main` é a fonte da verdade (monorepo completo). Duas branches espelho, idênticas a `main` no
momento da criação, existem só para apontar cada plataforma a uma branch dedicada (evita que um
push qualquer dispare rebuild nas duas plataformas ao mesmo tempo):

| Branch | Plataforma | Configuração |
|---|---|---|
| `vercel` | Vercel → Settings → Git → **Production Branch** = `vercel` | Root Directory `apps/web` (ver `vercel/README.md`). |
| `railway` | Railway → serviço `api`/`worker` → Settings → Source → **Branch** = `railway` | Build via `/railway.toml` na raiz (ver `railway/README.md`). |

**Fluxo de atualização:** desenvolva em `main`; quando for promover para produção, faça
`git push origin main:vercel` e/ou `git push origin main:railway` (fast-forward, sem merge commit)
para propagar exatamente o estado testado. Nunca commite direto em `vercel`/`railway`.

Pontos comuns:
- API: `apps/api/Dockerfile` (distroless; `dist/start.cjs`, `APP_ROLE=worker` para o worker). Web self-host: `apps/web/Dockerfile` + `apps/web/nginx.conf`.
- Migrations: `packages/db/prisma/migrations` (`npm run db:deploy`).
- JWT RS256: `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (PEM) ou `*_PATH` (arquivo). Gerar: `node apps/api/scripts/generate-jwt-keys.js`.
- Frontend aponta para a API via `VITE_API_BASE_URL` (build time); a API libera a origem via `CORS_ORIGIN`.
- Dev local continua em `infra/docker/docker-compose.dev.yml`.

## Alerting (Prometheus/Alertmanager/Grafana)

`apps/api` já expõe `/metrics` (formato Prometheus, autenticado por `METRICS_TOKEN`
em produção — ver `apps/api/src/lib/metrics.ts`) e `/health` / `/health/live` /
`/health/ready` (`server.ts`), mas nenhum Prometheus/Alertmanager roda neste
repositório — são serviços de infraestrutura externos que cada operador provisiona
no seu próprio ambiente. [`prometheus/alert-rules.yml`](prometheus/alert-rules.yml)
traz as regras prontas cobrindo: API fora do ar (`up == 0`), `/health` retornando
503, taxa de erro HTTP 5xx elevada, latência p95 elevada, profundidade/backlog de
fila BullMQ acima do limite e worker provavelmente parado (proxy via métrica de
fila, já que o worker não expõe HTTP próprio — ver comentário no próprio arquivo).

**Como ligar isto a um Prometheus/Alertmanager real:**
1. Provisione um Prometheus (gerenciado — Grafana Cloud, Railway template, etc. —
   ou self-host) com um `scrape_config` apontando para `https://<api>/metrics` a
   cada 15-30s, enviando o header `Authorization: Bearer <METRICS_TOKEN>`.
2. Carregue `prometheus/alert-rules.yml` via `rule_files:` no `prometheus.yml` do
   Prometheus provisionado (cada provedor gerenciado tem sua própria forma de
   subir regras customizadas — ex.: Grafana Cloud via "Alerting as code"/Mimir
   ruler API, Prometheus self-host via volume/ConfigMap).
3. Configure um Alertmanager (a maioria dos Prometheus gerenciados já inclui um)
   apontando para o canal de plantão (Slack/PagerDuty/e-mail) — os alertas usam
   `severity: critical` para indisponibilidade real e `severity: warning` para
   degradação, para permitir rotas diferentes no Alertmanager.
4. (Opcional, recomendado) Adicione um `blackbox_exporter` fazendo probe HTTP de
   `GET /health` a cada 30-60s — necessário para o alerta de "/health 503"
   funcionar quando o processo está de pé mas Postgres/Redis não respondem.
5. Importe/monte um dashboard Grafana usando as mesmas métricas (`filitech_api_*`)
   para visualização — fora do escopo deste repositório, mas qualquer dashboard
   genérico de "RED method" (Rate/Errors/Duration) funciona com as labels já
   expostas (`method`, `route`, `status`).

## Logs — retenção e shipping (fa-w6-obs-no-log-shipping-documented)

Hoje (`apps/api/src/lib/logger.ts`) o log é só `stdout` estruturado (JSON via
Pino) — sem nenhum shipping/retenção configurado neste repositório. Em produção
(Railway, ver `railway.toml`) isso significa depender inteiramente da captura de
stdout da própria plataforma, cuja retenção **não** é garantida por tempo longo o
suficiente para fins de auditoria/compliance (LGPD, investigação de incidente
meses depois) nem pesquisável de forma estruturada (sem full-text search, sem
dashboard).

**Recomendação de produção:**
- **Retenção mínima recomendada: 90 dias** para logs de aplicação (suficiente
  para a maioria das janelas de investigação de incidente/auditoria; ajustar para
  cima se exigido por um requisito regulatório/contratual específico do tenant).
- Configurar um **log drain** desde o dia 1 de produção real (não esperar o
  primeiro incidente para descobrir que o log já rotacionou/sumiu):
  - **Railway → Log Drain** (nativo, "Project Settings → Log Drains") apontando
    para um provedor de agregação, ou
  - Um agente de coleta (ex.: Vector, Fluent Bit) lendo stdout e encaminhando, ou
  - Diretamente um provedor como **Better Stack (Logtail)** ou **Datadog Logs**
    (ambos aceitam JSON estruturado como o emitido pelo Pino sem transformação).
- Os logs JÁ passam pelo redact de PII/segredos antes de sair do processo (ver
  `SENSITIVE_PATHS` em `lib/logger.ts`) — o provedor de shipping escolhido deve
  ser tratado como confiável o suficiente para reter dado estruturado de produção
  (ex.: não um bucket público, acesso restrito por equipe), mas não precisa de
  mascaramento adicional no destino para os campos já cobertos pela lista.
