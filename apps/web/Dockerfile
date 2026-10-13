# Build da SPA (apps/web) para o alvo de hospedagem auto-gerenciada (3º alvo,
# além de Vercel e Railway). Usa Nginx para servir os assets estáticos com fallback
# de SPA (todas as rotas não encontradas caem em index.html, igual ao vercel.json).
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
RUN npm install --workspace=@filitech/web --workspace=@filitech/design-tokens --include-workspace-root
COPY packages/design-tokens packages/design-tokens
COPY apps/web apps/web

ARG VITE_API_BASE_URL=http://localhost:3333
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build --workspace=@filitech/web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
