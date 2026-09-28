# Imagem de produção da API e do worker do Fruiqo (mesmo código, processo escolhido por FRUIQO_PROCESS).
# Contexto de build = raiz do monorepo (pnpm workspace, node-linker=hoisted).
# Padrão seguido do ProcreditoWeb: multi-stage, node:20-alpine, usuário não-root, tini, healthcheck /health.

# =============================================================================
# Stage 1: base com pnpm fixado no mesmo major do repositório
# =============================================================================
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# Manifests de TODO o workspace (o lockfile referencia todos os importers), sem código.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/taxonomy/package.json packages/taxonomy/package.json

# =============================================================================
# Stage 2: build (deps completas só da API e dos pacotes que ela usa)
# =============================================================================
FROM base AS builder
RUN pnpm install --frozen-lockfile --filter "@fruiqo/api..."
COPY packages/contracts ./packages/contracts
COPY packages/taxonomy ./packages/taxonomy
COPY apps/api ./apps/api
RUN pnpm --filter @fruiqo/taxonomy build \
 && pnpm --filter @fruiqo/contracts build \
 && pnpm --filter @fruiqo/api build

# pacote isolado da API: só dependências de produção dela (+ @fruiqo/* injetados), sem o resto do workspace
RUN pnpm --filter @fruiqo/api deploy --prod --legacy --config.allow-unused-patches=true /out  && cp -r apps/api/dist apps/api/drizzle apps/api/docker /out/  && rm -rf /out/src /out/test /out/scripts

# =============================================================================
# Stage 3: runner (só o pacote isolado)
# =============================================================================
FROM node:20-alpine AS runner
ENV NODE_ENV=production TZ=America/Sao_Paulo
RUN apk add --no-cache tini tzdata wget libc6-compat
WORKDIR /app
COPY --from=builder /out ./
RUN chmod +x docker/entrypoint.sh
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3   CMD sh -c 'test "$FRUIQO_PROCESS" = "worker" || wget -qO- "http://localhost:${PORT:-4000}/health" >/dev/null || exit 1'

ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
