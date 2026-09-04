# Ionnet Mailer — app image (API server + built web UI)
# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@11 && apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- dev: sources are bind-mounted by docker-compose.dev.yml ----------------
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3000 5173
CMD ["pnpm", "--filter", "@ionnet/server", "dev"]

# ---- build ------------------------------------------------------------------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps ./apps
RUN pnpm -r build
RUN pnpm --filter @ionnet/server --prod deploy --legacy /out/server && cp -r apps/web/dist /out/server/public

# ---- runtime ----------------------------------------------------------------
FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/server /app
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
