import { serve } from "@hono/node-server";

import { app } from "@/app";

const port = Number(process.env.PORT ?? 3001);

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
