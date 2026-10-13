# Deploy na Vercel (frontend `apps/web`)

SPA React 18 + Vite + MUI v5 servida pela CDN global da Vercel. A API fica no Railway (`../railway/README.md`) ou no self-host (`../generic-host/README.md`).

## Arquivo ativo
`apps/web/vercel.json` (a Vercel só o lê dentro do *Root Directory*; por isso não fica em `deploy/`):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "cd ../.. && npm run build --workspace=@filitech/web",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```
- `buildCommand` sobe para a raiz do monorepo e builda o workspace `@filitech/web` (`tsc -b && vite build`), pois o web depende de `packages/design-tokens`.
- `outputDirectory: dist` é relativo ao Root Directory (`apps/web/dist`).
- O `rewrite` faz o fallback de SPA (React Router) para `index.html`.
- O install é executado pela Vercel na raiz do repositório (detecta `workspaces` do `package.json`) — por isso **mantenha "Include source files outside of the Root Directory" ligado** (padrão).

## Passo a passo
1. https://vercel.com/new → **Import Git Repository** → escolha o repo do Filitech.
2. **Root Directory:** `apps/web` (Edit → selecione). Framework Preset: *Vite* (detectado). Build/Output já vêm do `vercel.json`; não sobrescreva no painel.
3. **Node.js Version:** 20.x (Settings → General).
4. **Environment Variables** (ver tabela) → Deploy.
5. Confirme que a API aceita a origem: adicione a URL da Vercel em `CORS_ORIGIN` da API.

## Variáveis de ambiente do frontend
Auditadas em `apps/web/src` (`import.meta.env.*`): existe **uma** única variável.

| Variável | Escopo | Descrição |
|---|---|---|
| `VITE_API_BASE_URL` | Production, Preview, Development | URL pública da API, sem barra final. Ex.: `https://api.seudominio.com`. Lida em `src/api/client.ts` e `src/shared/offline/sync-*.ts`. Se ausente, cai em `http://localhost:3333` (não funciona em produção). |

Variáveis `VITE_*` são embutidas no bundle em build time: alterou? Faça **Redeploy**. Nunca coloque segredos em variáveis `VITE_*` (ficam públicas).

## Domínio customizado
1. Project → **Settings → Domains → Add** → `app.seudominio.com`.
2. Crie no DNS o `CNAME app → cname.vercel-dns.com` (ou os registros A/NS indicados pelo painel para apex). HTTPS (Let's Encrypt) é automático.
3. Atualize `CORS_ORIGIN` na API para incluir `https://app.seudominio.com`.

## Preview deployments por PR
Habilitado por padrão: cada PR/branch gera uma URL `*.vercel.app` e comenta no PR.
- Defina `VITE_API_BASE_URL` no escopo **Preview** apontando para uma API de staging (ex.: um ambiente de PR do Railway), nunca para a produção com dados reais.
- A API precisa permitir a origem do preview em `CORS_ORIGIN` (origens exatas, separadas por vírgula; wildcards não são suportados pelo código atual).
- Para limitar builds: Settings → Git → *Ignored Build Step*.

## Verificação local
```bash
npm install
VITE_API_BASE_URL=https://api.seudominio.com npm run build --workspace=@filitech/web
```
