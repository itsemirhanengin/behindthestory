import { serve } from "@hono/node-server";

import { runMigrations } from "@behindthestory/db/migrate";

import { app } from "#app";

const port = Number(process.env.PORT ?? 3001);

/**
 * Migrate before accepting traffic. The alternative — a separate deploy step —
 * leaves a window where a rolled-out container talks to a schema it predates,
 * and the billing tables are the last place to discover that.
 *
 * Concurrent replicas are handled inside `runMigrations` with an advisory lock.
 */
await runMigrations();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});

/**
 * Railway sends SIGTERM before replacing a container. Without this the process
 * is killed mid-request, which for a streaming generation means the writer
 * loses the paragraph that was still arriving.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[api] ${signal} received, draining`);
    server.close(() => process.exit(0));
  });
}
