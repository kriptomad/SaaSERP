FROM node:20-slim AS base
WORKDIR /app
# Prisma precisa de OpenSSL para detectar o binaryTarget (debian-openssl-3.0.x) no generate.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspace=@filitech/db --workspace=@filitech/api --include-workspace-root

FROM base AS build
COPY packages/db packages/db
COPY apps/api apps/api
RUN npm run db:generate
# Gera dist/server.cjs e dist/worker.cjs (esbuild, ver apps/api/scripts/build.mjs).
RUN npm run build --workspace=@filitech/api
# Garante que os diretórios existam para os COPY --from=build abaixo (o npm pode ou não
# criar node_modules aninhado por workspace, dependendo do hoisting).
RUN mkdir -p /app/packages/db/node_modules /app/apps/api/node_modules

# Capítulo 3.1 — Docker Distroless em produção (sem shell, sem package manager, menor
# superfície de ataque possível). O estágio "build" acima usa node:20-slim (precisa de
# toolchain para compilar TypeScript e baixar engines do Prisma); o estágio final copia
# apenas os artefatos já compilados para a imagem distroless.
FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app
COPY --from=build /app/node_modules /app/node_modules
# @prisma/client, o client gerado (.prisma) e a CLI do prisma (migrate deploy) ficam
# aninhados em packages/db/node_modules; NODE_PATH os torna resolvíveis pelo bundle CJS.
COPY --from=build /app/packages/db/node_modules /app/packages/db/node_modules
COPY --from=build /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/packages/db/prisma /app/packages/db/prisma

ENV NODE_ENV=production
ENV NODE_PATH=/app/packages/db/node_modules:/app/node_modules
# GAP DE AUDITORIA FECHADO (Rodada 11): sem TZ explícito, o processo Node roda no
# fuso do container (UTC por padrão em praticamente toda imagem base de nuvem), e
# todo código que faz aritmética de "dia local" com `new Date(ano, mes, dia, ...)`
# (agenda pública de Capítulo 11.6, fechamento de caixa, boundaries de cobrança
# mensal, etc.) acaba calculando limites de dia errados para tenants brasileiros
# — ex.: um slot de agendamento às 21h BRT pode cair no dia seguinte em UTC.
# Node 20 embute ICU completo, então basta fixar TZ aqui (testado: afeta
# `new Date(...).toString()`/`Intl.DateTimeFormat().resolvedOptions().timeZone`
# sem exigir pacote `tzdata` extra na imagem distroless).
ENV TZ=America/Sao_Paulo
EXPOSE 3333
# O entrypoint da imagem distroless já é `node`; o CMD recebe apenas o script.
# Worker BullMQ: APP_ROLE=worker (dist/start.cjs) ou CMD ["apps/api/dist/worker.cjs"].
# Migrations (sem shell na imagem):
#   --entrypoint /nodejs/bin/node ... packages/db/node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma
CMD ["apps/api/dist/start.cjs"]