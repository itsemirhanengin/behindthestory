import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { authRoutes } from "#routes/auth";
import { chapterRoutes } from "#routes/chapters";
import { entityRoutes } from "#routes/entities";
import { novelContentRoutes } from "#routes/novel-content";
import { novelMergeRoutes } from "#routes/novel-merge";
import { novelSearchRoutes } from "#routes/novel-search";
import { novelTimelineRoutes } from "#routes/novel-timeline";
import { novelRoutes } from "#routes/novels";

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
  .route("/api/novels", novelRoutes)
  .route("/api/novels", novelTimelineRoutes)
  .route("/api/novels", novelSearchRoutes)
  .route("/api/novels", novelMergeRoutes)
  .route("/api/novels", novelContentRoutes)
  .route("/api/chapters", chapterRoutes)
  .route("/api/entities", entityRoutes);

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

/** Shared with the web client so its search UI is typed off the server. */
export type { SearchHit } from "#routes/novel-search";

/** Consumed by the web and mobile clients to type their calls. */
export type AppType = typeof routes;
