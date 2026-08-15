import type { PlanSlug, TopupKey } from "../plans";

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
  } | null;
};

/** A webhook, reduced to the three things this app acts on. */
export type ProviderEvent =
  | { kind: "state_changed"; externalId: string }
  | {
      kind: "order_paid";
      externalId: string;
      orderId: string;
      productId: string;
    }
  | { kind: "subscription_ended"; externalId: string }
  /** Verified and authentic, but nothing here needs to happen. */
  | { kind: "ignored"; type: string };

export interface BillingProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<{ url: string }>;
  createPortalSession(request: PortalRequest): Promise<{ url: string }>;
  /** Null when the provider has never heard of this workspace. */
  getCustomerState(workspaceId: string): Promise<ProviderCustomerState | null>;
  /**
   * Verifies the signature and normalises the payload. Throws on a bad
   * signature; returns `ignored` for an authentic event we do not act on.
   */
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): ProviderEvent;
}
