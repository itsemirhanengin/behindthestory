import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { BillingNotConfiguredError } from "@behindthestory/core/billing";

import { InsufficientWordsError } from "#lib/billing/meter";

import { aiCraftRoutes } from "#routes/ai-craft";
import { aiOnboardingRoutes } from "#routes/ai-onboarding";
import { aiReviewRoutes } from "#routes/ai-review";
import { aiWritingRoutes } from "#routes/ai-writing";
import { authRoutes } from "#routes/auth";
import { billingRoutes, billingWebhookRoutes } from "#routes/billing";
import { chapterRoutes } from "#routes/chapters";
import { entityRoutes } from "#routes/entities";
import { novelContentRoutes } from "#routes/novel-content";
import { novelDraftRoutes } from "#routes/novel-drafts";
import { novelMergeRoutes } from "#routes/novel-merge";
import { novelSearchRoutes } from "#routes/novel-search";
import { novelTimelineRoutes } from "#routes/novel-timeline";
import { novelRoutes } from "#routes/novels";
import { workspaceRoutes } from "#routes/workspaces";

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
  // Before the authenticated billing router, and deliberately outside it: the
  // provider has no session, only a signature.
  .route("/api/billing", billingWebhookRoutes)
  .route("/api/billing", billingRoutes)
  .route("/api/workspaces", workspaceRoutes)
  // Its own segment, not `/api/novels/draft`: the novels router's `/:novelId`
  // routes are mounted on that path and would swallow "draft" as an id.
  .route("/api/novel-drafts", novelDraftRoutes)
  .route("/api/novels", novelRoutes)
  .route("/api/novels", novelTimelineRoutes)
  .route("/api/novels", novelSearchRoutes)
  .route("/api/novels", novelMergeRoutes)
  .route("/api/novels", novelContentRoutes)
  .route("/api/chapters", chapterRoutes)
  .route("/api/entities", entityRoutes)
  .route("/api/ai", aiCraftRoutes)
  .route("/api/ai", aiReviewRoutes)
  .route("/api/ai", aiWritingRoutes)
  .route("/api/ai/onboarding", aiOnboardingRoutes);

export const app = new Hono()
  .use("*", logger())
  /**
   * One place where thrown failures become responses. Guards throw
   * `HTTPException` so a 404 from an ownership check reads the same to the
   * client whichever route raised it.
   */
  .onError((error, c) => {
    /**
     * Running out of words is the one failure the client has to *do* something
     * about rather than just show, so it carries a code the studio can switch
     * on instead of matching the prose of the message.
     */
    if (error instanceof InsufficientWordsError) {
      return c.json(
        { error: error.message, code: error.code, detail: error.detail },
        402,
      );
    }
    /**
     * Checkout asked for a product nobody has configured yet. A setup gap
     * rather than a fault, and the deployer needs to be told which variable —
     * a bare 500 leaves both the writer and the operator guessing.
     */
    if (error instanceof BillingNotConfiguredError) {
      console.error(`[billing] ${error.message}`);
      return c.json(
        {
          error:
            "Payments are not set up on this deployment yet. Add the Polar product ids to the environment.",
          code: "billing_not_configured",
        },
        503,
      );
    }
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
