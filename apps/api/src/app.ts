import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { authRoutes } from "@/routes/auth";
import { novelRoutes } from "@/routes/novels";

/**
 * The API surface.
 *
 * Routes are mounted as one chained expression because Hono infers the RPC
 * client's types from that chain — assigning to a variable between mounts would
 * hand `apps/studio` and the mobile app an untyped client, which is the whole
 * reason this service is Hono and not something else.
 */
const routes = new Hono()
  .route("/api/auth", authRoutes)
  .route("/api/novels", novelRoutes);

export const app = new Hono()
  .use("*", logger())
  /**
   * One place where thrown failures become responses. Guards throw
   * `HTTPException` so a 404 from an ownership check reads the same to the
   * client whichever route raised it.
   */
  .onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    console.error("[api] unhandled", error);
    return c.json({ error: "Internal error" }, 500);
  })
  .get("/health", (c) => c.json({ ok: true }))
  .route("/", routes);

/** Consumed by the web and mobile clients to type their calls. */
export type AppType = typeof routes;
