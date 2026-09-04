import type { PaidPlanSlug, PlanSlug, TopupKey } from "../plans";

/**
 * What the rest of the app is allowed to know about taking money.
 *
 * The abstraction is not speculative. Polar's acceptable-use policy explicitly
 * prohibits marketplaces — "selling others' products or services … with an
 * agreed upon revenue share" — and there is no payouts or connected-accounts
 * API to build one on. The marketplace this product is heading towards will
 * therefore need a second provider (Stripe Connect) running alongside this
 * one, not instead of it. Keeping the seam here means that day is an added
 * implementation rather than a rewrite of every call site.
 */

export type CheckoutRequest = {
  workspaceId: string;
  /** Shown on the provider's page and used to create their customer record. */
  customerEmail: string;
  /** The caller's IP. Without it the provider geolocates our server and gets
   *  the wrong currency and the wrong tax. */
  customerIp?: string | null;
  item: { type: "plan"; plan: PlanSlug } | { type: "topup"; pack: TopupKey };
  successUrl: string;
};

export type PortalRequest = { workspaceId: string; returnUrl: string };

/**
 * Moving an existing subscription to another plan.
 *
 * `when` is the whole decision, and it is the caller's to make rather than the
 * provider adapter's: `now` settles the difference in money today and applies
 * the plan immediately, `next_period` schedules it for the renewal and moves
 * no money at all. Upgrades want the first, downgrades the second — but that
 * mapping is policy, and policy does not belong in an adapter.
 */
export type PlanChangeRequest = {
  subscriptionId: string;
  plan: PaidPlanSlug;
  when: "now" | "next_period";
};

/** The provider's view of a workspace, normalised. */
export type ProviderCustomerState = {
  customerId: string;
  subscription: {
    id: string;
    productId: string;
    planSlug: PlanSlug | null;
    status: string;
    /** True for `active` and `trialing` — anything the plan should apply for. */
    entitled: boolean;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    /**
     * A plan change the provider has scheduled for the next period.
     *
     * Three states, and the difference between two of them matters: a slug is
     * a change that is coming, `null` is the provider saying there is none,
     * and `undefined` is us having failed to ask. Only the first two are
     * grounds for overwriting what we have stored — treating "could not tell"
     * as "nothing scheduled" would erase a real downgrade from the page the
     * moment a read hiccupped.
     */
    pendingPlanSlug?: PlanSlug | null;
    pendingPlanAt?: Date | null;
  } | null;
};

/**
 * One order, normalised — enough to decide what a refund of it means.
 *
 * Refund webhooks name an order and a customer id, not a workspace and not a
 * product, so this read is what turns a refund into something actionable.
 */
export type ProviderOrder = {
  id: string;
  /** Our workspace id, if the provider has it. */
  externalId: string | null;
  productId: string | null;
  subscriptionId: string | null;
  /** Minor units. */
  totalAmount: number;
  refundedAmount: number;
  /** Whether the whole order has now been given back, not just part of it. */
  fullyRefunded: boolean;
  currency: string;
  createdAt: Date;
};

/** A webhook, reduced to the handful of things this app acts on. */
export type ProviderEvent =
  | { kind: "state_changed"; externalId: string }
  | {
      kind: "order_paid";
      externalId: string;
      orderId: string;
      productId: string;
    }
  | { kind: "subscription_ended"; externalId: string }
  /**
   * Money actually given back — never a refund that is merely pending, since
   * a pending one can still fail and a workspace must not lose its plan for a
   * refund that never happened.
   */
  | {
      kind: "refund_succeeded";
      refundId: string;
      orderId: string;
      amount: number;
      currency: string;
      reason: string;
    }
  /** Verified and authentic, but nothing here needs to happen. */
  | { kind: "ignored"; type: string };

export interface BillingProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<{ url: string }>;
  createPortalSession(request: PortalRequest): Promise<{ url: string }>;
  /** Null when the provider has never heard of this workspace. */
  getCustomerState(workspaceId: string): Promise<ProviderCustomerState | null>;
  /** Moves a live subscription to another plan. */
  changePlan(request: PlanChangeRequest): Promise<void>;
  /** Ends a subscription immediately, rather than at the period boundary. */
  revokeSubscription(subscriptionId: string): Promise<void>;
  /** Calls off a cancellation that has not taken effect yet. */
  resumeSubscription(subscriptionId: string): Promise<void>;
  /** Null when the order is unknown to the provider. */
  getOrder(orderId: string): Promise<ProviderOrder | null>;
  /**
   * Verifies the signature and normalises the payload. Throws on a bad
   * signature; returns `ignored` for an authentic event we do not act on.
   */
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): ProviderEvent;
}
