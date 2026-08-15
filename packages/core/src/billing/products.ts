import {
  PLANS,
  TOPUP_PACKS,
  isPlanSlug,
  isTopupKey,
  type PlanSlug,
  type TopupKey,
} from "../plans";

/**
 * The mapping between our plan slugs and the provider's product ids.
 *
 * Product ids live in the environment rather than in code because sandbox and
 * production are different Polar organisations with different ids for the same
 * product — hard-coding either one guarantees that testing a change against
 * sandbox and shipping it are mutually exclusive.
 *
 * Free has no product: nobody checks out for it, it is what a workspace has
 * when it has nothing else.
 */

const PLAN_ENV: Record<Exclude<PlanSlug, "free">, string> = {
  starter: "POLAR_PRODUCT_STARTER_MONTHLY",
  pro: "POLAR_PRODUCT_PRO_MONTHLY",
  team: "POLAR_PRODUCT_TEAM_MONTHLY",
};

const TOPUP_ENV: Record<TopupKey, string> = {
  words30k: "POLAR_PRODUCT_WORDS_30K",
  words100k: "POLAR_PRODUCT_WORDS_100K",
  words300k: "POLAR_PRODUCT_WORDS_300K",
};

/**
 * Raised when a product exists in the price list but not in the environment.
 *
 * Its own class because this is a setup problem, not a bug: the honest answer
 * to the writer is "this cannot be bought yet", and the honest answer to
 * whoever deployed it is which variable is missing. A generic 500 says neither.
 */
export class BillingNotConfiguredError extends Error {
  constructor(readonly variable: string) {
    super(
      `${variable} is not set. Create the product in Polar and put its id in the environment.`,
    );
    this.name = "BillingNotConfiguredError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new BillingNotConfiguredError(name);
  return value;
}

/** Whether checkout can work at all. Drives the studio's setup notice. */
export function isBillingConfigured(): boolean {
  return Boolean(process.env.POLAR_ACCESS_TOKEN);
}

export function productIdForPlan(plan: Exclude<PlanSlug, "free">): string {
  return required(PLAN_ENV[plan]);
}

export function productIdForTopup(pack: TopupKey): string {
  return required(TOPUP_ENV[pack]);
}

/**
 * Reverse lookup, for webhooks: the provider tells us a product id and we have
 * to decide what was bought.
 *
 * Built on demand rather than cached, so a product id corrected in the
 * environment takes effect on restart rather than needing a deploy — and so a
 * missing id is an error at the point it is needed, not at import time.
 */
export function resolveProduct(
  productId: string,
): { type: "plan"; plan: PlanSlug } | { type: "topup"; pack: TopupKey } | null {
  for (const slug of Object.keys(PLAN_ENV)) {
    if (!isPlanSlug(slug) || slug === "free") continue;
    if (process.env[PLAN_ENV[slug]] === productId) {
      return { type: "plan", plan: slug };
    }
  }
  for (const key of Object.keys(TOPUP_ENV)) {
    if (!isTopupKey(key)) continue;
    if (process.env[TOPUP_ENV[key]] === productId) {
      return { type: "topup", pack: key };
    }
  }
  return null;
}

/** What the studio needs to render the pricing page. Safe to send to a client. */
export function billingCatalogue() {
  return {
    plans: Object.values(PLANS).map((plan) => ({
      slug: plan.slug,
      label: plan.label,
      priceCents: plan.priceCents,
      monthlyWords: plan.monthlyWords,
      seats: plan.seats,
      models: plan.models,
      modelPicker: plan.modelPicker,
    })),
    topups: Object.values(TOPUP_PACKS),
  };
}
