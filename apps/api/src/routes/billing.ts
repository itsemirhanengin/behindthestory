import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { aiGenerations, billingSubscriptions, getDb } from "@behindthestory/db";
import {
  PLAN_SLUGS,
  TOPUP_KEYS,
  planFor,
  type PlanSlug,
} from "@behindthestory/core/plans";
import { ensureBalance, readBalance } from "@behindthestory/core/word-balance";

import { requireAuth, type AuthEnv } from "#middleware/auth";
import { clientIp } from "#lib/auth/request";
import { assertMember, assertWorkspaceAdmin } from "#lib/auth/workspace";
import {
  applyProviderEvent,
  billingCatalogue,
  claimWebhookDelivery,
  isBillingConfigured,
  polarProvider,
  syncWorkspaceFromProvider,
  WebhookVerificationError,
} from "@behindthestory/core/billing";

const provider = polarProvider;

function appUrl(path: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}

const checkoutSchema = z.object({
  item: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("plan"),
      // Free is not purchasable — it is what you have when you have nothing.
      plan: z.enum(PLAN_SLUGS.filter((s): s is Exclude<PlanSlug, "free"> => s !== "free")),
    }),
    z.object({ type: z.literal("topup"), pack: z.enum(TOPUP_KEYS) }),
  ]),
});

/**
 * Everything that touches money.
 *
 * The webhook is mounted on a separate router with no `requireAuth`, because
 * Polar has no session — its authenticity comes from the signature. It is also
 * why the studio must not proxy it: Polar does not follow redirects, and a
 * 3xx from the Next rewrite counts as a delivery failure. Point the endpoint
 * straight at the API's own hostname.
 */
export const billingWebhookRoutes = new Hono().post("/webhook", async (c) => {
  // The signature is over the exact bytes; parsing first and re-serialising
  // would change them.
  const rawBody = await c.req.text();
  const headers = Object.fromEntries(c.req.raw.headers.entries());

  let event;
  try {
    event = provider.verifyWebhook(rawBody, headers);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.warn("[billing] rejected an unsigned webhook");
      return c.json({ error: "Invalid signature" }, 403);
    }
    throw error;
  }

  const deliveryId = headers["webhook-id"];
  if (deliveryId) {
    const first = await claimWebhookDelivery(deliveryId, event.kind);
    // Polar retries up to ten times and does not order deliveries. A repeat is
    // routine; acknowledging it is what stops the retry loop.
    if (!first) return c.json({ ok: true, duplicate: true });
  }

  await applyProviderEvent(provider, event);
  return c.json({ ok: true });
});

export const billingRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  /** Plan and pack definitions, so the pricing UI is not a second copy. */
  .get("/catalogue", (c) =>
    c.json({ ...billingCatalogue(), configured: isBillingConfigured() }),
  )
  .get("/:workspaceId/summary", async (c) => {
    const workspaceId = c.req.param("workspaceId");
    await assertMember(c.get("user").id, workspaceId);

    const balance = (await readBalance(workspaceId)) ?? (await ensureBalance(workspaceId));
    const plan = planFor(balance.planSlug);

    const [subscription] = await getDb()
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.workspaceId, workspaceId));

    // What the words went on this period — the question the balance alone
    // never answers.
    const byRoute = await getDb()
      .select({
        route: aiGenerations.route,
        words: sql<number>`coalesce(sum(${aiGenerations.wordsCharged}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.workspaceId, workspaceId),
          gte(aiGenerations.createdAt, balance.periodStart),
        ),
      )
      .groupBy(aiGenerations.route)
      .orderBy(desc(sql`sum(${aiGenerations.wordsCharged})`));

    /**
     * What the period actually cost us, and how much of the input the
     * providers served from their own cache.
     *
     * Not shown to the writer — it is the margin, and the number that decides
     * whether restructuring the prompt for cache hits is worth doing. A
     * `cacheReadTokens` that stays at zero is the evidence that it is.
     */
    const [economics] = await getDb()
      .select({
        usdCost: sql<string>`coalesce(sum(${aiGenerations.usdCost}), 0)::text`,
        inputTokens: sql<number>`coalesce(sum(${aiGenerations.inputTokens}), 0)::int`,
        cacheReadTokens: sql<number>`coalesce(sum(${aiGenerations.cacheReadTokens}), 0)::int`,
      })
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.workspaceId, workspaceId),
          gte(aiGenerations.createdAt, balance.periodStart),
        ),
      );

    return c.json({
      plan: {
        slug: plan.slug,
        label: plan.label,
        monthlyWords: plan.monthlyWords,
        seats: plan.seats,
        models: plan.models,
        modelPicker: plan.modelPicker,
      },
      balance: {
        planWordsRemaining: balance.planWordsRemaining,
        topupWordsRemaining: balance.topupWordsRemaining,
        totalRemaining: balance.totalRemaining,
        wordsHeld: balance.wordsHeld,
        periodStart: balance.periodStart,
        periodEnd: balance.periodEnd,
      },
      subscription: subscription
        ? {
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            currentPeriodEnd: subscription.currentPeriodEnd,
          }
        : null,
      usage: byRoute,
      economics: {
        usdCost: Number(economics?.usdCost ?? 0),
        inputTokens: economics?.inputTokens ?? 0,
        cacheReadTokens: economics?.cacheReadTokens ?? 0,
      },
    });
  })
  /**
   * Pulls the current state from the provider, now, instead of waiting.
   *
   * Webhooks are the mechanism for everything that happens while nobody is
   * looking — renewals, cancellations, failed cards. They are the wrong
   * mechanism for the moment a writer has just paid and is watching the page:
   * the redirect and the webhook race, and losing that race means the studio
   * tells someone who just entered their card details that they are on Free.
   *
   * Doing it on demand also means a local checkout works with no webhook
   * tunnel at all, which is one fewer thing to have set up correctly before
   * the first test payment can be believed.
   */
  .post("/:workspaceId/sync", async (c) => {
    const workspaceId = c.req.param("workspaceId");
    await assertMember(c.get("user").id, workspaceId);

    if (!isBillingConfigured()) return c.json({ synced: false });

    const { planSlug } = await syncWorkspaceFromProvider(provider, workspaceId);
    return c.json({ synced: true, planSlug });
  })
  .post("/:workspaceId/checkout", zValidator("json", checkoutSchema), async (c) => {
    const workspaceId = c.req.param("workspaceId");
    // Buying is an owner/admin action; a member should not be able to put a
    // charge on someone else's card.
    await assertWorkspaceAdmin(c.get("user").id, workspaceId);

    const { item } = c.req.valid("json");
    const { url } = await provider.createCheckout({
      workspaceId,
      customerEmail: c.get("user").email,
      customerIp: clientIp(c.req.raw),
      item,
      successUrl: appUrl("/settings/billing?checkout=success"),
    });

    return c.json({ url });
  })
  .post("/:workspaceId/portal", async (c) => {
    const workspaceId = c.req.param("workspaceId");
    await assertWorkspaceAdmin(c.get("user").id, workspaceId);

    try {
      const { url } = await provider.createPortalSession({
        workspaceId,
        returnUrl: appUrl("/settings/billing"),
      });
      return c.json({ url });
    } catch {
      throw new HTTPException(409, {
        message: "This workspace has no subscription to manage yet.",
      });
    }
  });
