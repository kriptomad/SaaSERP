# Deploy — três destinos segregados

Cada pasta é um alvo independente e tem seu próprio guia. Os arquivos que a plataforma exige em local fixo continuam onde ela os procura (`/railway.toml`, `apps/web/vercel.json`); `deploy/` guarda guias e configs adicionais.

| Destino | Hospeda | Guia | Quando usar |
|---|---|---|---|
| **Railway** | `apps/api` + worker + Postgres + Redis gerenciados | [`railway/README.md`](railway/README.md) | Caminho mais rápido para o backend gerenciado: sem servidor para operar, deploy por push, banco/Redis em 2 cliques. Custo cresce com uso. |
| **Vercel** | `apps/web` (SPA estática) | [`vercel/README.md`](vercel/README.md) | Frontend com CDN global e preview por PR. Combine com Railway **ou** com a API self-host. |
| **Generic host** | Tudo (web, api, worker, Postgres, Redis, HTTPS) via Docker Compose | [`generic-host/README.md`](generic-host/README.md) | Controle total e menor custo em escala (Hetzner/DigitalOcean). Exige operar backups, atualizações e segurança do servidor. |

Combinações típicas: **Vercel + Railway** (início/MVP) · **Generic host sozinho** (custo/controle) · Vercel + API no generic host.

Pontos comuns:
- API: `apps/api/Dockerfile` (distroless; `dist/start.cjs`, `APP_ROLE=worker` para o worker). Web self-host: `apps/web/Dockerfile` + `apps/web/nginx.conf`.
- Migrations: `packages/db/prisma/migrations` (`npm run db:deploy`).
- JWT RS256: `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (PEM) ou `*_PATH` (arquivo). Gerar: `node apps/api/scripts/generate-jwt-keys.js`.
- Frontend aponta para a API via `VITE_API_BASE_URL` (build time); a API libera a origem via `CORS_ORIGIN`.
- Dev local continua em `infra/docker/docker-compose.dev.yml`.
