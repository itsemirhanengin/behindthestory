/**
 * The model catalogue and what each one costs.
 *
 * Deliberately free of any database or SDK import: the studio bundles this file
 * to render a model picker and to show what an action will cost before the
 * writer commits to it, and neither of those should drag `pg` into the browser.
 *
 * Prices are USD per million tokens, taken from the Vercel AI Gateway
 * catalogue. They are the *provider list* rates — if the gateway ever adds a
 * margin, this table is the single place that has to learn about it.
 */

export type ModelId =
  | "google/gemini-3.7-flash"
  | "openai/gpt-5.4-mini"
  | "anthropic/claude-haiku-4.5"
  | "xai/grok-4.6";

export type ModelSpec = {
  id: ModelId;
  label: string;
  provider: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** Rate for input served from the provider's cache; null when it has none. */
  cachedInputUsdPerMTok: number | null;
  /**
   * What writing the cache costs, as a multiple of the normal input rate.
   * Anthropic bills a premium for the write; the providers with implicit
   * caching do not charge for it separately, so the multiplier is 1.
   */
  cacheWriteMultiplier: number;
  /** Whether a `cacheControl` breakpoint is honoured, vs. implicit caching. */
  explicitCaching: boolean;
  contextWindow: number;
  /**
   * Reserved. Plans are priced against the most expensive model in the
   * catalogue, so a generated word costs the writer the same whichever model
   * produced it — no multiplier, nothing to explain in the UI. Turning this
   * into a real per-model factor later needs no schema change.
   */
  weight: number;
};

export const MODEL_CATALOGUE = {
  "google/gemini-3.7-flash": {
    id: "google/gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    provider: "Google",
    inputUsdPerMTok: 0.75,
    outputUsdPerMTok: 3.75,
    cachedInputUsdPerMTok: 0.07,
    cacheWriteMultiplier: 1,
    explicitCaching: true,
    contextWindow: 1_000_000,
    weight: 1,
  },
  "openai/gpt-5.4-mini": {
    id: "openai/gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    provider: "OpenAI",
    inputUsdPerMTok: 0.75,
    outputUsdPerMTok: 4.5,
    cachedInputUsdPerMTok: 0.075,
    cacheWriteMultiplier: 1,
    explicitCaching: false,
    contextWindow: 400_000,
    weight: 1,
  },
  "anthropic/claude-haiku-4.5": {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    provider: "Anthropic",
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 5,
    cachedInputUsdPerMTok: 0.1,
    cacheWriteMultiplier: 1.25,
    explicitCaching: true,
    contextWindow: 200_000,
    weight: 1,
  },
  "xai/grok-4.6": {
    id: "xai/grok-4.6",
    label: "Grok 4.6",
    provider: "xAI",
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 6,
    /**
     * It does serve cached input — a live call came back reporting cache
     * reads — but the gateway catalogue publishes no discounted rate for it.
     * Left null so cached tokens are priced at the full input rate: that
     * overstates what we paid rather than understating it, which is the safe
     * direction for a figure that decides margins. Fill in the real rate if
     * xAI publishes one.
     */
    cachedInputUsdPerMTok: null,
    cacheWriteMultiplier: 1,
    explicitCaching: false,
    contextWindow: 500_000,
    weight: 1,
  },
} as const satisfies Record<ModelId, ModelSpec>;

export const MODEL_IDS = Object.keys(MODEL_CATALOGUE) as ModelId[];

/**
 * The most expensive model per generated word, and therefore the one the plan
 * allowances are sized against. Everything cheaper is margin.
 */
export const REFERENCE_MODEL: ModelId = "xai/grok-4.6";

/**
 * Extraction, critique and outline work always runs here regardless of what
 * the writer picked for prose. The quality difference on structured-output
 * tasks does not justify the price spread, and pinning it is what lets the
 * per-action word prices be a fixed published number rather than a range.
 */
export const UTILITY_MODEL: ModelId = "google/gemini-3.7-flash";

/** Cheapest capable model — what Free writes with, and the fallback default. */
export const DEFAULT_MODEL: ModelId = "google/gemini-3.7-flash";

export function isModelId(value: string | null | undefined): value is ModelId {
  return value != null && value in MODEL_CATALOGUE;
}

export function modelSpec(id: ModelId): ModelSpec {
  return MODEL_CATALOGUE[id];
}

/**
 * The token counts we care about, flattened out of the AI SDK's nested
 * `LanguageModelUsage`. Every field is optional because providers report
 * different subsets and a missing detail must read as zero, not as NaN.
 */
export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  /** Input served from cache. A *subset* of `inputTokens`. */
  cacheReadTokens?: number;
  /** Input written to cache. Also a subset of `inputTokens`. */
  cacheWriteTokens?: number;
  /** Reasoning tokens. A *subset* of `outputTokens` — never added on top. */
  reasoningTokens?: number;
};

/** Pulls the fields above out of whatever shape the SDK handed back. */
export function toTokenUsage(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: {
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
  };
  outputTokenDetails?: { reasoningTokens?: number | undefined };
}): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

/**
 * What a generation cost us, in dollars.
 *
 * Two subtleties, both of which cost real money if got wrong:
 * `cacheReadTokens` and `cacheWriteTokens` are *already inside* `inputTokens`,
 * so they are subtracted before the full rate is applied rather than added on
 * top; and `reasoningTokens` are already inside `outputTokens`, so they are
 * recorded for visibility but never billed twice.
 */
export function usdCost(id: ModelId, usage: TokenUsage): number {
  const spec = MODEL_CATALOGUE[id];

  const input = usage.inputTokens ?? 0;
  const cacheRead = spec.cachedInputUsdPerMTok == null ? 0 : (usage.cacheReadTokens ?? 0);
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const fullRate = Math.max(input - cacheRead - cacheWrite, 0);

  const inputUsd =
    (fullRate * spec.inputUsdPerMTok +
      cacheRead * (spec.cachedInputUsdPerMTok ?? spec.inputUsdPerMTok) +
      cacheWrite * spec.inputUsdPerMTok * spec.cacheWriteMultiplier) /
    1_000_000;

  const outputUsd = ((usage.outputTokens ?? 0) * spec.outputUsdPerMTok) / 1_000_000;

  return inputUsd + outputUsd;
}

/**
 * Embeddings are priced separately and are not on the picker — one model,
 * chosen by the vector column's dimension rather than by the writer.
 */
export const EMBEDDING_USD_PER_MTOK = 0.02;

export function embeddingUsdCost(tokens: number): number {
  return (tokens * EMBEDDING_USD_PER_MTOK) / 1_000_000;
}
