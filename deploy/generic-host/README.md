# Self-hosting em VPS genérica (Docker Compose)

Controle total e menor custo em escala (Capítulo 3.1: Hetzner/DigitalOcean/qualquer VPS). Sobe tudo em um host: Postgres 15, Redis 7, API, worker BullMQ, web (Nginx) e, opcionalmente, Caddy com HTTPS.

## Arquivos
| Arquivo | Função |
|---|---|
| `docker-compose.yml` | Stack completa. Build a partir de `apps/api/Dockerfile` e `apps/web/Dockerfile` (contexto = raiz do monorepo). |
| `.env.example` | Todas as variáveis do compose (copie para `.env`). |
| `Caddyfile` | Reverse proxy HTTPS automático (perfil `https`). |
| `secrets/` | Par de chaves JWT (`jwt-private.pem`, `jwt-public.pem`) — gitignored. |

Serviços: `postgres` (volume `filitech_postgres_data`), `redis` (senha + AOF, volume `filitech_redis_data`; o namespace de cache por tenant `tenant:{id}:cache` é só convenção de chave — nenhuma configuração extra), `migrate` (job one-shot `prisma migrate deploy`), `api` (:3333, healthcheck `/health`), `worker`, `web` (Nginx :80 → host :8080), `caddy` (profile `https`).

## Requisitos do servidor
- Linux x86_64 (Ubuntu 22.04/24.04 ou Debian 12), **2 vCPU / 4 GB RAM / 40 GB SSD** no mínimo (o build do Prisma/TypeScript usa ~2 GB; adicione swap em VPS de 2 GB).
- Docker Engine 24+ com plugin Compose v2 (`docker compose version`).
- Portas 80/443 abertas (HTTPS); 22 para SSH. Postgres/Redis **não** são publicados no host.
- DNS A/AAAA de `app.seudominio.com` e `api.seudominio.com` apontando para a VPS (para HTTPS).

## Subindo
```bash
git clone <repo> && cd <repo>/deploy/generic-host
cp .env.example .env
# preencha .env: POSTGRES_PASSWORD, REDIS_PASSWORD (openssl rand -hex 24),
# INTEGRATION_CREDENTIALS_MASTER_KEY (openssl rand -base64 32), CORS_ORIGIN, VITE_API_BASE_URL, domínios

# chaves JWT RS256
node ../../apps/api/scripts/generate-jwt-keys.js        # gera apps/api/keys/*.pem
cp ../../apps/api/keys/jwt-private.pem secrets/ && cp ../../apps/api/keys/jwt-public.pem secrets/
# (sem Node no host: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out secrets/jwt-private.pem
#                    && openssl rsa -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem)

docker compose config -q                 # valida .env + YAML
docker compose up -d --build             # sem HTTPS (acesso em 127.0.0.1:8080 / :3333)
docker compose --profile https up -d --build   # com Caddy + HTTPS automático
docker compose ps && curl -s http://127.0.0.1:3333/health
```
`BIND_ADDRESS=127.0.0.1` (padrão) mantém api/web acessíveis só localmente (atrás do Caddy ou de um túnel SSH). Use `0.0.0.0` apenas para testes sem HTTPS.

## Migrações
Rodam automaticamente: o serviço `migrate` executa `prisma migrate deploy` (migrations em `packages/db/prisma/migrations`) e a `api` só inicia após ele terminar com sucesso. Manualmente, após atualizar o código:
```bash
git pull && docker compose build api && docker compose run --rm migrate
docker compose up -d
```
A imagem é distroless (sem shell); o job chama `/nodejs/bin/node packages/db/node_modules/prisma/build/index.js migrate deploy`.

## HTTPS
**Opção A — Caddy (incluso):** `--profile https`; certificados Let's Encrypt automáticos para `APP_DOMAIN` e `API_DOMAIN`, renovação automática, dados em `filitech_caddy_data`. Requer 80/443 livres e DNS já propagado. Defina `VITE_API_BASE_URL=https://api.seudominio.com` e `CORS_ORIGIN=https://app.seudominio.com`, depois `docker compose build web && docker compose up -d`.

**Opção B — Nginx + Certbot no host:** mantenha `BIND_ADDRESS=127.0.0.1`, instale `nginx certbot python3-certbot-nginx` e crie dois server blocks com `proxy_pass http://127.0.0.1:8080;` (app) e `proxy_pass http://127.0.0.1:3333;` (api, com `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header Host $host;`), depois `certbot --nginx -d app.seudominio.com -d api.seudominio.com`. Não suba o profile `https` (conflito de portas 80/443).

## Backup do banco
Dump lógico diário (cron do host, `crontab -e`):
```bash
0 3 * * * cd /opt/filitech/deploy/generic-host && docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > /var/backups/filitech/filitech_$(date +\%F).dump && find /var/backups/filitech -name '*.dump' -mtime +14 -delete
```
Restauração (em banco vazio):
```bash
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < filitech_2026-01-01.dump
```
Copie os dumps para fora do host (rclone/restic para R2/S3/Backblaze) e **teste a restauração periodicamente**. Faça também backup de `.env` e `secrets/` em cofre separado — perder `INTEGRATION_CREDENTIALS_MASTER_KEY` ou as chaves JWT é irrecuperável. Para RPO/RTO do Capítulo 3.6 (Patroni + pgBackRest) use um Postgres gerenciado/HA; este compose é single-node.

## Operação
```bash
docker compose logs -f api worker      # logs
docker compose pull postgres redis caddy && docker compose up -d   # atualizar imagens base
docker compose down                    # para (volumes preservados); `down -v` APAGA os dados
```
Atualizar a aplicação: `git pull && docker compose up -d --build`.
