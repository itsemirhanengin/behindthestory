import { Polar } from "@polar-sh/sdk";
import { eq } from "drizzle-orm";
import { Webhook } from "standardwebhooks";
import { z } from "zod";

import { billingCustomers, getDb } from "@behindthestory/db";
import { isPlanSlug, type PlanSlug } from "../plans";

import { productIdForPlan, productIdForTopup, resolveProduct } from "./products";
import type {
  BillingProvider,
  CheckoutRequest,
  PortalRequest,
  ProviderCustomerState,
  ProviderEvent,
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

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
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
        ? productIdForPlan(request.item.plan as Exclude<PlanSlug, "free">)
        : productIdForTopup(request.item.pack);

    const checkout = await polar().checkouts.create({
      products: [productId],
      // Our workspace id is Polar's `external_id`, which is what makes every
      // webhook resolvable without a lookup table.
      externalCustomerId: request.workspaceId,
      customerEmail: request.customerEmail,
      customerIpAddress: request.customerIp ?? undefined,
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

  async getCustomerState(workspaceId: string): Promise<ProviderCustomerState | null> {
    let state;
    try {
      state = await polar().customers.getStateExternal({ externalId: workspaceId });
    } catch {
      // A workspace that has never checked out has no Polar customer, which is
      // a 404 rather than a failure.
      return null;
    }

    await rememberCustomer(workspaceId, state.id);

    // Only one subscription per workspace is meaningful here; if Polar somehow
    // reports several, the newest period wins.
    const active = [...(state.activeSubscriptions ?? [])].sort(
      (a, b) =>
        (toDate(b.currentPeriodStart)?.getTime() ?? 0) -
        (toDate(a.currentPeriodStart)?.getTime() ?? 0),
    )[0];

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

      default:
        return { kind: "ignored", type };
    }
  },
};
