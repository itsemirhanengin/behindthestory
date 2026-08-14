# syntax=docker/dockerfile:1
#
# Build context is the monorepo root. Railway needs the service's root directory
# set to the repo root and this file given as the Dockerfile path.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/studio/package.json apps/studio/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
RUN pnpm install --frozen-lockfile --filter @behindthestory/worker...

COPY . .
RUN pnpm --filter @behindthestory/worker build
RUN pnpm --filter @behindthestory/worker deploy --prod --legacy /out

FROM base AS runtime
ENV NODE_ENV=production

USER node

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/package.json ./package.json

# No EXPOSE and no healthcheck: this service serves no HTTP. Railway treats a
# container that stays up as healthy, which is the right signal here — BullMQ
# holds a blocking read on Redis for as long as it is waiting for work.

# Exec form so the process is PID 1 and receives SIGTERM directly; src/index.ts
# uses it to let running jobs finish instead of dying mid-embedding.
CMD ["node", "dist/index.js"]
