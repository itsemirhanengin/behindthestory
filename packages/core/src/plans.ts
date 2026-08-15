import {
  DEFAULT_MODEL,
  MODEL_IDS,
  isModelId,
  type ModelId,
} from "@behindthestory/ai/models";

/**
 * What a workspace may do, and what it costs.
 *
 * Pure data and pure functions, no database and no zod — the studio imports
 * this to price an action before running it, and the API imports it to enforce
 * the same numbers. One table, two readers, nothing to keep in sync.
 *
 * ## Why words
 *
 * The obvious unit is tokens, and it is the wrong one. A chapter draft sends
 * ~40,000 tokens of story context to produce ~2,400 tokens of prose, so a
 * writer told they have "100,000 tokens" would reasonably expect ~70,000 words
 * and actually get two chapters. Selling the output — the words they keep — is
 * the only unit that means to them what it means to us.
 *
 * Input is not free, it is just bounded: `AI_CONTEXT_BUDGET` caps every prompt
 * at 40,000 tokens, so cost per call has a ceiling and the allowances below are
 * sized against it.
 */

export const PLAN_SLUGS = ["free", "starter", "pro", "team"] as const;
export type PlanSlug = (typeof PLAN_SLUGS)[number];

export type Plan = {
  slug: PlanSlug;
  label: string;
  /** Monthly price in USD cents. Zero for Free. */
  priceCents: number;
  /** Words granted at the start of each billing period. Do not roll over. */
  monthlyWords: number;
  seats: number;
  /**
   * Which models prose generations may use. Free is pinned to one model and
   * renders no picker at all — a chooser whose every option but one is locked
   * sells nothing and looks broken.
   */
  models: readonly ModelId[];
  /** Whether the studio shows a model picker for this plan. */
  modelPicker: boolean;
  /** Per-workspace ceiling on AI requests, as a second guard beyond words. */
  rateLimit: { limit: number; windowSeconds: number };
};

export const PLANS = {
  free: {
    slug: "free",
    label: "Free",
    priceCents: 0,
    monthlyWords: 10_000,
    seats: 1,
    models: [DEFAULT_MODEL],
    modelPicker: false,
    rateLimit: { limit: 30, windowSeconds: 60 * 60 },
  },
  starter: {
    slug: "starter",
    label: "Starter",
    priceCents: 600,
    monthlyWords: 60_000,
    seats: 1,
    models: MODEL_IDS,
    modelPicker: true,
    rateLimit: { limit: 120, windowSeconds: 60 * 60 },
  },
  pro: {
    slug: "pro",
    label: "Pro",
    priceCents: 1_400,
    monthlyWords: 150_000,
    seats: 1,
    models: MODEL_IDS,
    modelPicker: true,
    rateLimit: { limit: 300, windowSeconds: 60 * 60 },
  },
  team: {
    slug: "team",
    label: "Team",
    priceCents: 3_900,
    monthlyWords: 400_000,
    seats: 5,
    models: MODEL_IDS,
    modelPicker: true,
    rateLimit: { limit: 900, windowSeconds: 60 * 60 },
  },
} as const satisfies Record<PlanSlug, Plan>;

export const FREE_PLAN = PLANS.free;

export function isPlanSlug(value: string | null | undefined): value is PlanSlug {
  return value != null && value in PLANS;
}

export function planFor(slug: string | null | undefined): Plan {
  return isPlanSlug(slug) ? PLANS[slug] : FREE_PLAN;
}

/**
 * Which model a prose generation actually runs on.
 *
 * A workspace that downgrades keeps its stored preference; this is what stops
 * that stale preference from silently continuing to bill a Free workspace at a
 * paid model's rate.
 */
export function resolveWritingModel(
  plan: Plan,
  preferred: string | null | undefined,
): ModelId {
  if (isModelId(preferred) && plan.models.includes(preferred)) return preferred;
  return plan.models[0] ?? DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// Top-up packs
// ---------------------------------------------------------------------------

export const TOPUP_KEYS = ["words30k", "words100k", "words300k"] as const;
export type TopupKey = (typeof TOPUP_KEYS)[number];

export type TopupPack = { key: TopupKey; label: string; words: number; priceCents: number };

/**
 * Bought once, never expire. Plan words are spent first, so a top-up is a
 * reserve rather than a balance that quietly evaporates at the month boundary
 * — which is the behaviour people expect from something they paid for outright.
 */
export const TOPUP_PACKS = {
  words30k: { key: "words30k", label: "30,000 words", words: 30_000, priceCents: 500 },
  words100k: { key: "words100k", label: "100,000 words", words: 100_000, priceCents: 1_400 },
  words300k: { key: "words300k", label: "300,000 words", words: 300_000, priceCents: 3_600 },
} as const satisfies Record<TopupKey, TopupPack>;

export function isTopupKey(value: string | null | undefined): value is TopupKey {
  return value != null && value in TOPUP_PACKS;
}

// ---------------------------------------------------------------------------
// What each action costs, in words
// ---------------------------------------------------------------------------

/**
 * The exchange rate between dollars of model spend and words charged.
 *
 * Derived from the reference model writing a default-length chapter: 40,000
 * input + ~2,400 output tokens on Grok 4.6 is $0.094 for 1,800 words, so a
 * word is worth $0.0000522 of budget. Every fixed price below is that division.
 */
export const USD_PER_WORD = 0.000_052;

/**
 * Prose routes charge the words they actually produced — but never fewer than
 * this.
 *
 * Without a floor the cheapest way to burn our money is a hundred one-sentence
 * regenerations: each one pays for a full 40,000-token context and is charged
 * for forty words. A normal chapter draft is well over the floor, so this is
 * invisible in ordinary use.
 */
export const PROSE_MIN_WORDS: Record<string, number> = {
  chapter: 800,
  "chapter:beat": 800,
  inline: 100,
};

/**
 * Fixed prices for the routes whose output is structured data rather than
 * prose the writer keeps. All of them run on the utility model against a
 * capped context, so the real cost has a ceiling and a published flat number
 * is honest — and far easier to show on a button than a range.
 */
export const ROUTE_WORD_COST: Record<string, number> = {
  continuity: 700,
  analyze: 700,
  relationships: 700,
  outline: 400,
  character: 200,
  location: 200,
  style: 200,
  "onboarding:reading": 150,
  "onboarding:style": 150,
  /**
   * Indexing a chapter for retrieval costs about $0.00005. Charging for it
   * would cost more in explaining than it recovers, so it is metered for
   * visibility and billed at nothing.
   */
  embedding: 0,
};

/**
 * Output ceilings, per route.
 *
 * The fixed prices above are only honest if the cost they stand for has an
 * upper bound. Input already does — `AI_CONTEXT_BUDGET` caps the prompt — but
 * without a cap on output a continuity report that decides to enumerate every
 * sentence in the chapter costs several times what it charged.
 *
 * Every ceiling is generous on purpose. It is a backstop against a runaway
 * generation, not a length target, and the model should never be shaped by it.
 * Three of the four catalogue models spend output tokens reasoning before they
 * answer, and that reasoning comes out of the same budget: a live call capped
 * at 64 tokens returned 61 reasoning tokens and an empty answer. A cap tight
 * enough to bind is a cap that silently truncates.
 */
export const ROUTE_MAX_OUTPUT_TOKENS: Record<string, number> = {
  chapter: 16_000,
  "chapter:beat": 16_000,
  inline: 4_000,
  continuity: 6_000,
  analyze: 8_000,
  relationships: 4_000,
  outline: 4_000,
  character: 4_000,
  location: 3_000,
  style: 3_000,
  "onboarding:reading": 4_000,
  "onboarding:style": 3_000,
};

export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;

export function maxOutputTokensForRoute(route: string): number {
  return (
    ROUTE_MAX_OUTPUT_TOKENS[route] ??
    ROUTE_MAX_OUTPUT_TOKENS[route.split(":")[0]] ??
    DEFAULT_MAX_OUTPUT_TOKENS
  );
}

/** Prose routes are charged by output; everything else has a fixed price. */
export function isProseRoute(route: string): boolean {
  return route === "chapter" || route === "chapter:beat" || route.startsWith("inline");
}

/**
 * What to charge for one generation.
 *
 * `generatedWords` is only consulted for prose routes; a fixed-price route
 * charges the same whether the model wrote three fields or thirty.
 */
export function wordsForRoute(route: string, generatedWords = 0): number {
  if (isProseRoute(route)) {
    const floor = PROSE_MIN_WORDS[route] ?? PROSE_MIN_WORDS[route.split(":")[0]] ?? 0;
    return Math.max(Math.round(generatedWords), floor);
  }
  return ROUTE_WORD_COST[route] ?? ROUTE_WORD_COST[route.split(":")[0]] ?? 0;
}

/**
 * What to hold before a generation starts, before anyone knows how long it
 * will be. Overestimating is the safe direction: the difference is refunded on
 * settle, whereas underestimating lets a workspace finish the month in debt.
 */
export function estimateWordsForRoute(
  route: string,
  hint?: { targetChapterWords?: number },
): number {
  if (!isProseRoute(route)) return wordsForRoute(route);
  if (route.startsWith("inline")) return wordsForRoute(route, 200);
  return wordsForRoute(route, hint?.targetChapterWords ?? 1_800);
}

/** Whitespace-separated runs. Good enough — it is the unit we sell, not prose analysis. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
