# syntax=docker/dockerfile:1
#
# Build context is the monorepo root, not this directory — the app is compiled
# together with the workspace packages it imports. Railway needs the service's
# root directory set to the repo root and this file given as the Dockerfile path.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build

# Manifests first, source second: editing a route re-runs the build but reuses
# the cached install layer. Every workspace manifest has to be present or pnpm
# treats the lockfile as stale, even for a filtered install.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/studio/package.json apps/studio/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
RUN pnpm install --frozen-lockfile --filter @behindthestory/api...

COPY . .
RUN pnpm --filter @behindthestory/api build

# esbuild inlines the workspace packages and leaves npm packages external, so
# the runtime needs `dependencies` only. `--legacy` is required because this
# workspace deliberately does not set `inject-workspace-packages`: injection
# copies packages instead of symlinking them, which would break the just-in-time
# `packages/*` setup during local development.
RUN pnpm --filter @behindthestory/api deploy --prod --legacy /out

FROM base AS runtime
ENV NODE_ENV=production
# Railway overrides PORT; this is the fallback that matches local development.
ENV PORT=3001

# node:*-alpine ships a `node` user. Running as root in a container that faces
# the public internet buys nothing.
USER node

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/package.json ./package.json

# esbuild inlines code, not data. The generated migration SQL has to be copied
# in separately, or the boot-time migrate fails looking for meta/_journal.json.
# `DB_MIGRATIONS_DIR` defaults to this path.
COPY --from=build --chown=node:node /app/packages/db/migrations ./migrations

EXPOSE 3001

# Exec form, no shell wrapper: the process must be PID 1 so that the SIGTERM
# handler in src/index.ts actually receives Railway's shutdown signal and can
# drain in-flight generation streams.
CMD ["node", "dist/index.js"]
