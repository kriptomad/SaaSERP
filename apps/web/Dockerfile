# Build da SPA (apps/web) para o alvo de hospedagem auto-gerenciada (3º alvo,
# além de Vercel e Railway). Usa Nginx para servir os assets estáticos com fallback
# de SPA (todas as rotas não encontradas caem em index.html, igual ao vercel.json).
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
RUN npm ci --workspace=@filitech/web --workspace=@filitech/design-tokens --include-workspace-root
COPY packages/design-tokens packages/design-tokens
COPY apps/web apps/web

ARG VITE_API_BASE_URL=http://localhost:3333
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build --workspace=@filitech/web

# fa-infra-web-dockerfile-no-nonroot-user: a imagem oficial `nginx` roda o processo
# master como root (necessário para fazer bind na porta privilegiada 80 antes de
# abaixar privilégio para o worker `nginx`). A variante `nginxinc/nginx-unprivileged`
# remove completamente a necessidade de root: todo o processo (master + workers) já
# roda como usuário não-root (uid 101) e escuta por padrão em uma porta >1024 (8080),
# sem exigir CAP_NET_BIND_SERVICE nem qualquer passo extra de usuário neste Dockerfile.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
# fa-infra-web-dockerfile-no-healthcheck: sinaliza o estado real do Nginx/assets
# mesmo quando a imagem roda fora do docker-compose documentado (ex.: `docker run`
# manual, outro orquestrador). `wget` (BusyBox) já vem na imagem alpine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/health || exit 1
