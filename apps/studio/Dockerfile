# syntax=docker/dockerfile:1
#
# Build context is the monorepo root. Railway needs the service's root directory
# set to the repo root and this file given as the Dockerfile path.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/studio/package.json apps/studio/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
RUN pnpm install --frozen-lockfile --filter @behindthestory/studio...

COPY . .

# `rewrites()` is evaluated during `next build` and frozen into
# routes-manifest.json — API_URL is a build input, not a runtime one. Setting it
# only as a Railway service variable would silently ship an image that proxies
# to localhost:3001.
ARG API_URL
ENV API_URL=$API_URL
RUN test -n "$API_URL" || (echo "API_URL build arg is required" && exit 1)

RUN pnpm --filter @behindthestory/studio build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# server.js binds 127.0.0.1 unless told otherwise, which is unreachable from
# outside the container.
ENV PORT=3000 HOSTNAME=0.0.0.0

USER node

# The standalone tree mirrors the monorepo layout because tracing is rooted at
# the repo root, so server.js lands under apps/studio/. Static assets and public
# are not copied by the tracer and have to be placed by hand.
COPY --from=build --chown=node:node /app/apps/studio/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/studio/.next/static ./apps/studio/.next/static
COPY --from=build --chown=node:node /app/apps/studio/public ./apps/studio/public

EXPOSE 3000

CMD ["node", "apps/studio/server.js"]
