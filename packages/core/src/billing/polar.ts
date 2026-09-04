import { isIP } from "node:net";

import { Polar } from "@polar-sh/sdk";
import { eq } from "drizzle-orm";
import { Webhook } from "standardwebhooks";
import { z } from "zod";

import { billingCustomers, getDb } from "@behindthestory/db";
import { isPlanSlug, type PaidPlanSlug, type PlanSlug } from "../plans";

import { productIdForPlan, productIdForTopup, resolveProduct } from "./products";
import type {
  BillingProvider,
  CheckoutRequest,
  PlanChangeRequest,
  PortalRequest,
  ProviderCustomerState,
  ProviderEvent,
  ProviderOrder,
} from "./provider";

/**
 * Polar, as this app uses it — which is far less than Polar offers.
 *
 * No meters, no usage events, no benefits. Polar sells a subscription or a
 * one-off pack and tells us it happened; the word balance is entirely ours.
 * That is not laziness: Polar's own documentation says "we will never prohibit
 * any customer's action based on their Usage Meter balance", and the balance
 * behind that meter is debounced by at least fifteen seconds — so it cannot be
 * the thing a generation checks before it runs. Once the enforcing ledger has
 * to live here anyway, mirroring it into Polar buys nothing and adds a second
 * set of numbers that can disagree with the first.
 */

/** Thrown for a signature that does not check out. Never for a shape we
 *  simply do not recognise — that is an authentic event we ignore. */
export class WebhookVerificationError extends Error {}

/**
 * The access token is real but is not allowed to do this.
 *
 * A setup problem wearing the clothes of a server error. Polar answers 403
 * `insufficient_scope` and names the scope it wanted, and left alone that
 * became a bare "Internal error" in the studio — which tells the writer their
 * upgrade is broken and tells whoever deployed it nothing at all. Its own
 * class so the route can say which scope is missing, the way
 * `BillingNotConfiguredError` already does for a missing product id.
 */
export class ProviderPermissionError extends Error {
  constructor(readonly scope: string) {
    super(
      `The Polar access token is missing the \`${scope}\` scope. Add it to the token in Polar (Settings → Developers), then restart the API.`,
    );
    this.name = "ProviderPermissionError";
  }
}

/**
 * Digs a 403 out of whatever the SDK threw.
 *
 * Not an `instanceof` check on an SDK error class, because the SDK does not
 * reliably produce one here: its generated response validator has no schema
 * for an `insufficient_scope` body, so the 403 surfaces as a *validation*
 * failure with the real status buried in `cause`. Walking the chain for a
 * status and a scope is what survives that.
 */
function failureDetail(
  error: unknown,
  depth = 0,
): { status: number | null; text: string } {
  if (depth > 4 || typeof error !== "object" || error === null) {
    return { status: null, text: "" };
  }

  const candidate = error as {
    status?: number;
    rawResponse?: { status?: number; headers?: { get?: (n: string) => string | null } };
    body$?: string;
    message?: string;
    cause?: unknown;
  };

  const status = candidate.status ?? candidate.rawResponse?.status ?? null;
  const text = `${candidate.body$ ?? ""} ${candidate.message ?? ""} ${
    candidate.rawResponse?.headers?.get?.("www-authenticate") ?? ""
  }`;

  if (status !== null) return { status, text };

  const deeper = failureDetail(candidate.cause, depth + 1);
  return { status: deeper.status, text: `${text} ${deeper.text}` };
}

function permissionScope(error: unknown, fallback: string): string | null {
  const { status, text } = failureDetail(error);
  if (status !== 403 && !text.includes("insufficient_scope")) return null;
  // The header states the scope it wanted; fall back to the caller's guess.
  return /scope="([^"]+)"/.exec(text)?.[1] ?? fallback;
}

/** Re-throws a provider refusal as something a person can act on. */
function rethrowPermission(error: unknown, fallbackScope: string): never {
  const scope = permissionScope(error, fallbackScope);
  if (scope) throw new ProviderPermissionError(scope);
  throw error;
}

/**
 * Only the fields acted on, everything else passed over.
 *
 * Deliberately permissive: Polar sends far more than this and will send more
 * still, and a schema that rejects an unfamiliar field is a schema that drops
 * payments the day the provider ships a feature.
 */
const eventShape = z.object({
  type: z.string(),
  data: z
    .object({
      id: z.string().optional(),
      external_id: z.string().nullish(),
      product_id: z.string().nullish(),
      customer: z.object({ external_id: z.string().nullish() }).nullish(),
      /* Refunds only. They carry no `external_id` at all — a refund names an
         order and a customer id, so the workspace is reached by reading the
         order back. */
      status: z.string().nullish(),
      order_id: z.string().nullish(),
      amount: z.number().nullish(),
      currency: z.string().nullish(),
      reason: z.string().nullish(),
    })
    .loose(),
});

let client: Polar | null = null;

function polar(): Polar {
  if (client) return client;

  const accessToken = process.env.POLAR_ACCESS_TOKEN;
  if (!accessToken) throw new Error("POLAR_ACCESS_TOKEN is not set");

  /**
   * Sandbox is a separate Polar organisation with its own token and its own
   * product ids, so this and every `POLAR_PRODUCT_*` have to move together.
   *
   * Defaulting to sandbox is the safe direction — the wrong guess costs a
   * failed request rather than a real charge — but it is a silent one: a
   * production token against the sandbox host answers 401, and nothing in
   * that error mentions this variable. So say it out loud.
   */
  const configured = process.env.POLAR_SERVER;
  const server = configured === "production" ? "production" : "sandbox";

  if (!configured) {
    console.warn(
      "[billing] POLAR_SERVER is not set — falling back to sandbox. " +
        "If these are production credentials every call will fail with 401. " +
        "Set POLAR_SERVER=production or POLAR_SERVER=sandbox explicitly.",
    );
  }

  client = new Polar({ accessToken, server });
  return client;
}

function planFromProduct(productId: string): PlanSlug | null {
  const resolved = resolveProduct(productId);
  return resolved?.type === "plan" && isPlanSlug(resolved.plan) ? resolved.plan : null;
}

/**
 * An address, or nothing at all — never a word standing in for one.
 *
 * `clientIp` answers `"unknown"` when there is no proxy header, which is the
 * right bucket key for a rate limiter and is not an address. Polar validates
 * this field and rejects the entire checkout over it, so every request without
 * an `x-forwarded-for` — which is every local one — failed at the provider
 * with a validation error that mentions none of this. Sending nothing is
 * allowed; the field only exists so the provider geolocates the buyer rather
 * than our server, and a wrong answer there is worse than no answer.
 */
function ipAddressOrNothing(value: string | null | undefined): string | undefined {
  return value && isIP(value) ? value : undefined;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * The plan change Polar has scheduled for the next period, if any.
 *
 * A second request, because the customer-state payload — where every other
 * field here comes from — does not carry `pending_update`. Worth the round
 * trip: it makes a scheduled downgrade the provider's fact rather than our
 * bookkeeping, so it corrects itself on every sync instead of drifting. The
 * alternative is what this replaced, where an upgrade left a stale "Starter
 * from 4 October" note on the page for a downgrade Polar had already
 * cancelled.
 *
 * Returns an empty object when it cannot be read at all — never `null`, which
 * would claim there is nothing scheduled. See `pendingPlanSlug` on
 * `ProviderCustomerState` for why those two must stay distinguishable.
 */
async function scheduledChange(
  subscriptionId: string,
  liveProductId: string,
): Promise<{ pendingPlanSlug?: PlanSlug | null; pendingPlanAt?: Date | null }> {
  let subscription;
  try {
    subscription = await polar().subscriptions.get({ id: subscriptionId });
  } catch {
    // Deliberately quiet and deliberately non-fatal: a plan the writer can
    // still see beats a billing page that will not load.
    return {};
  }

  const pending = subscription.pendingUpdate;

  /* Polar records an update even when it names the product already in force —
     which is exactly what our own "stay on this plan" does, since superseding
     a schedule means sending another one. That is the absence of a change, not
     a change to the same thing. */
  if (!pending?.productId || pending.productId === liveProductId) {
    return { pendingPlanSlug: null, pendingPlanAt: null };
  }

  return {
    pendingPlanSlug: planFromProduct(pending.productId),
    pendingPlanAt: toDate(pending.appliesAt),
  };
}

async function rememberCustomer(workspaceId: string, customerId: string) {
  await getDb()
    .insert(billingCustomers)
    .values({ workspaceId, provider: "polar", providerCustomerId: customerId })
    .onConflictDoUpdate({
      target: billingCustomers.workspaceId,
      set: { providerCustomerId: customerId },
    });
}

export const polarProvider: BillingProvider = {
  name: "polar",

  async createCheckout(request: CheckoutRequest) {
    const productId =
      request.item.type === "plan"
        ? productIdForPlan(request.item.plan as PaidPlanSlug)
        : productIdForTopup(request.item.pack);

    const checkout = await polar().checkouts.create({
      products: [productId],
      // Our workspace id is Polar's `external_id`, which is what makes every
      // webhook resolvable without a lookup table.
      externalCustomerId: request.workspaceId,
      customerEmail: request.customerEmail,
      customerIpAddress: ipAddressOrNothing(request.customerIp),
      successUrl: request.successUrl,
      metadata: { workspaceId: request.workspaceId },
    });

    return { url: checkout.url };
  },

  async createPortalSession(request: PortalRequest) {
    const [row] = await getDb()
      .select({ customerId: billingCustomers.providerCustomerId })
      .from(billingCustomers)
      .where(eq(billingCustomers.workspaceId, request.workspaceId));

    if (!row) {
      throw new Error("This workspace has never checked out, so it has no portal.");
    }

    // Short-lived by design — generated at click time, never stored.
    const session = await polar().customerSessions.create({
      customerId: row.customerId,
    });

    return { url: session.customerPortalUrl };
  },

  /**
   * Moves a subscription to another product.
   *
   * `invoice` settles the difference on the spot: the unused remainder of the
   * old plan is credited against the new plan's charge, so the writer sees one
   * net movement rather than a refund followed by a charge — two lines on a
   * statement that read as a billing mistake. Polar makes the change
   * contingent on that payment succeeding, so a declined card leaves the
   * subscription exactly as it was rather than half-changed.
   *
   * `next_period` moves no money and applies nothing today; it rewrites what
   * the renewal will charge. A pending change is superseded by the next
   * request rather than queued behind it, which is what makes changing one's
   * mind twice harmless.
   *
   * Both preserve the billing anchor — only Polar's `reset` starts a fresh
   * cycle, and a plan change that silently moved someone's renewal date would
   * be the least explainable thing on the billing page.
   */
  async changePlan(request: PlanChangeRequest) {
    try {
      await polar().subscriptions.update({
        id: request.subscriptionId,
        subscriptionUpdate: {
          productId: productIdForPlan(request.plan),
          prorationBehavior: request.when === "now" ? "invoice" : "next_period",
        },
      });
    } catch (error) {
      rethrowPermission(error, "subscriptions:write");
    }
  },

  async revokeSubscription(subscriptionId: string) {
    try {
      await polar().subscriptions.revoke({ id: subscriptionId });
    } catch (error) {
      rethrowPermission(error, "subscriptions:write");
    }
  },

  async getOrder(orderId: string): Promise<ProviderOrder | null> {
    let order;
    try {
      order = await polar().orders.get({ id: orderId });
    } catch (error) {
      // An order we cannot see is not an order that does not exist; only a
      // 404 means that, and anything else has to be loud — a refund silently
      // skipped is a plan nobody is paying for.
      if (failureDetail(error).status === 404) return null;
      rethrowPermission(error, "orders:read");
    }

    return {
      id: order.id,
      externalId: order.customer?.externalId ?? null,
      productId: order.productId ?? null,
      subscriptionId: order.subscriptionId ?? null,
      totalAmount: order.totalAmount,
      refundedAmount: order.refundedAmount,
      /**
       * Polar's own verdict rather than our arithmetic. Comparing amounts
       * would have to account for tax, discounts and an applied balance
       * separately, and get all three right to reach the conclusion the
       * provider has already published.
       */
      fullyRefunded: order.status === "refunded",
      currency: order.currency,
      createdAt: toDate(order.createdAt) ?? new Date(),
    };
  },

  async getCustomerState(workspaceId: string): Promise<ProviderCustomerState | null> {
    let state;
    try {
      state = await polar().customers.getStateExternal({ externalId: workspaceId });
    } catch (error) {
      /**
       * A workspace that has never checked out has no Polar customer, which is
       * a 404 rather than a failure — that one answer is legitimately "no
       * subscription".
       *
       * Everything else must throw. This used to swallow every error and
       * report `null`, which `syncWorkspaceFromProvider` reads as "not
       * entitled": an under-scoped token or an hour of Polar downtime would
       * therefore delete the subscription row and drop the workspace to Free
       * — silently, and for every paying workspace at once, since the nightly
       * reconcile runs this over all of them. Failing loudly leaves the last
       * known plan in place, which is the safe direction.
       */
      if (failureDetail(error).status === 404) return null;
      rethrowPermission(error, "customers:read");
    }

    await rememberCustomer(workspaceId, state.id);

    // Only one subscription per workspace is meaningful here; if Polar somehow
    // reports several, the newest period wins.
    const active = [...(state.activeSubscriptions ?? [])].sort(
      (a, b) =>
        (toDate(b.currentPeriodStart)?.getTime() ?? 0) -
        (toDate(a.currentPeriodStart)?.getTime() ?? 0),
    )[0];

    const scheduled = active ? await scheduledChange(active.id, active.productId) : {};

    return {
      customerId: state.id,
      subscription: active
        ? {
            id: active.id,
            productId: active.productId,
            planSlug: planFromProduct(active.productId),
            status: active.status,
            entitled: active.status === "active" || active.status === "trialing",
            currentPeriodStart: toDate(active.currentPeriodStart),
            currentPeriodEnd: toDate(active.currentPeriodEnd),
            cancelAtPeriodEnd: Boolean(active.cancelAtPeriodEnd),
            ...scheduled,
          }
        : null,
    };
  },

  /**
   * Verifies the signature, then reads only the handful of fields this app
   * acts on.
   *
   * Notably *not* using the SDK's `validateEvent`, which couples signature
   * verification to an exhaustive zod parse of the whole payload. That
   * coupling has two failure modes and both are silent: it throws on any
   * event type missing from its switch — `subscription.cycled`, `.paused` and
   * `.resumed` are all absent from 0.49 — and it throws on a known event whose
   * shape has drifted by so much as one field. Catching both and shrugging
   * would mean a paid top-up quietly never credited; distinguishing them means
   * reimplementing its switch anyway.
   *
   * So: verify with the same Standard Webhooks primitive the SDK uses, then
   * pull out the four fields below. New event types become "ignored" without a
   * code change, and drift in a field we do not read cannot break a payment.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string>): ProviderEvent {
    const secret = process.env.POLAR_WEBHOOK_SECRET;
    if (!secret) throw new Error("POLAR_WEBHOOK_SECRET is not set");

    // The SDK base64-encodes the plaintext secret before handing it over; the
    // signature will not match otherwise.
    const verifier = new Webhook(Buffer.from(secret, "utf-8").toString("base64"));

    let payload: unknown;
    try {
      payload = verifier.verify(rawBody, headers);
    } catch (error) {
      throw new WebhookVerificationError(
        error instanceof Error ? error.message : "Invalid webhook signature",
      );
    }

    const parsed = eventShape.safeParse(payload);
    if (!parsed.success) {
      // Authentic, but not even shaped like an event. Nothing to do with it.
      return { kind: "ignored", type: "unrecognised" };
    }
    const { type, data } = parsed.data;

    switch (type) {
      /**
       * The one event worth acting on. It fires for customer changes,
       * subscription changes and benefit grants alike, and carries the whole
       * customer state — so a single handler that re-reads and overwrites is
       * correct regardless of what actually changed, and regardless of the
       * order deliveries arrive in (Polar guarantees none).
       */
      case "customer.state_changed":
        return { kind: "state_changed", externalId: data.external_id ?? "" };

      case "order.paid":
        return {
          kind: "order_paid",
          externalId: data.customer?.external_id ?? "",
          orderId: data.id ?? "",
          productId: data.product_id ?? "",
        };

      case "subscription.revoked":
      case "subscription.canceled":
        return {
          kind: "subscription_ended",
          externalId: data.customer?.external_id ?? "",
        };

      /**
       * A refund arrives twice — once as created, again as updated when it
       * settles — and only `succeeded` means the money has actually moved. A
       * `pending` refund can still fail, and a workspace that lost its plan
       * for a refund that never completed would have paid and got nothing.
       *
       * Both types funnel into one event because the handler is idempotent on
       * the refund id: whichever delivery arrives first with `succeeded` does
       * the work, and the other is a no-op.
       */
      case "refund.created":
      case "refund.updated":
        if (data.status !== "succeeded") {
          return { kind: "ignored", type: `${type}:${data.status ?? "unknown"}` };
        }
        return {
          kind: "refund_succeeded",
          refundId: data.id ?? "",
          orderId: data.order_id ?? "",
          amount: data.amount ?? 0,
          currency: data.currency ?? "usd",
          reason: data.reason ?? "",
        };

      default:
        return { kind: "ignored", type };
    }
  },
};
