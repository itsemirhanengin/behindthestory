import { describe, expect, it } from "vitest";

import {
  MODEL_CATALOGUE,
  REFERENCE_MODEL,
  toTokenUsage,
  usdCost,
  type ModelId,
} from "@behindthestory/ai/models";
import {
  PLANS,
  ROUTE_WORD_COST,
  TOPUP_PACKS,
  USD_PER_WORD,
  countWords,
  estimateWordsForRoute,
  isProseRoute,
  maxOutputTokensForRoute,
  planChangeDirection,
  planFor,
  resolveWritingModel,
  wordsForRoute,
} from "./plans";

/**
 * The arithmetic behind the price list.
 *
 * These are not tests of the implementation so much as of the business: if a
 * plan stops covering its own worst case, or a fixed price stops covering what
 * the action actually costs, the failure is silent everywhere else — it shows
 * up as a margin that quietly went negative.
 */

/** The shape every published figure was derived from. */
const CHAPTER = { inputTokens: 40_000, outputTokens: 2_400 };

describe("charging", () => {
  it("charges prose by the words it produced", () => {
    expect(wordsForRoute("chapter", 1_800)).toBe(1_800);
    expect(wordsForRoute("inline:rewrite", 240)).toBe(240);
  });

  it("floors a prose charge so tiny regenerations cannot be free", () => {
    // The abuse this exists for: burn a 40,000-token context, produce forty
    // words, pay for forty words, repeat.
    expect(wordsForRoute("chapter", 40)).toBe(800);
    expect(wordsForRoute("inline:expand", 5)).toBe(100);
  });

  it("charges non-prose routes a fixed price regardless of output", () => {
    expect(wordsForRoute("continuity", 0)).toBe(700);
    expect(wordsForRoute("continuity", 99_999)).toBe(700);
  });

  it("falls back on the route family for an unlisted variant", () => {
    expect(wordsForRoute("inline:something-new", 300)).toBe(300);
    expect(maxOutputTokensForRoute("inline:something-new")).toBe(
      maxOutputTokensForRoute("inline"),
    );
  });

  it("knows which routes are prose", () => {
    expect(isProseRoute("chapter")).toBe(true);
    expect(isProseRoute("chapter:beat")).toBe(true);
    expect(isProseRoute("inline:dialogue")).toBe(true);
    expect(isProseRoute("continuity")).toBe(false);
    expect(isProseRoute("onboarding:reading")).toBe(false);
  });

  it("reserves at least what it will charge", () => {
    // Under-reserving is the dangerous direction: the tokens are spent before
    // the shortfall is discovered.
    for (const route of Object.keys(ROUTE_WORD_COST)) {
      expect(estimateWordsForRoute(route)).toBeGreaterThanOrEqual(
        wordsForRoute(route),
      );
    }
    expect(estimateWordsForRoute("chapter", { targetChapterWords: 3_000 })).toBe(3_000);
    expect(estimateWordsForRoute("chapter")).toBe(1_800);
  });
});

describe("plan economics", () => {
  /** Polar's Starter fee, which is what the allowances were sized against. */
  const netRevenueUsd = (priceCents: number) =>
    priceCents === 0 ? 0 : priceCents / 100 - ((priceCents / 100) * 0.05 + 0.5);

  it("keeps every paid plan profitable even if all of it runs on the priciest model", () => {
    for (const plan of Object.values(PLANS)) {
      if (plan.priceCents === 0) continue;
      const worstCaseAiUsd = plan.monthlyWords * USD_PER_WORD;
      expect(worstCaseAiUsd).toBeLessThan(netRevenueUsd(plan.priceCents));
    }
  });

  it("keeps every top-up pack profitable on the same basis", () => {
    for (const pack of Object.values(TOPUP_PACKS)) {
      const worstCaseAiUsd = pack.words * USD_PER_WORD;
      expect(worstCaseAiUsd).toBeLessThan(netRevenueUsd(pack.priceCents));
    }
  });

  it("prices a word at what the reference model actually charges for one", () => {
    // USD_PER_WORD is the whole exchange rate; if the catalogue moves and this
    // constant does not, every fixed price silently stops covering its cost.
    const perWord = usdCost(REFERENCE_MODEL, CHAPTER) / 1_800;
    expect(perWord).toBeGreaterThan(USD_PER_WORD * 0.9);
    expect(perWord).toBeLessThan(USD_PER_WORD * 1.1);
  });

  it("charges at least what each fixed-price action costs to run", () => {
    // Every one of these runs on the utility model against a capped context.
    const shapes: Record<string, { inputTokens: number; outputTokens: number }> = {
      continuity: { inputTokens: 40_000, outputTokens: 1_500 },
      analyze: { inputTokens: 40_000, outputTokens: 1_500 },
      relationships: { inputTokens: 40_000, outputTokens: 1_200 },
      outline: { inputTokens: 20_000, outputTokens: 1_200 },
      character: { inputTokens: 10_000, outputTokens: 700 },
      location: { inputTokens: 10_000, outputTokens: 700 },
      style: { inputTokens: 10_000, outputTokens: 700 },
      "onboarding:reading": { inputTokens: 5_000, outputTokens: 800 },
      "onboarding:style": { inputTokens: 5_000, outputTokens: 800 },
    };

    for (const [route, shape] of Object.entries(shapes)) {
      const charged = ROUTE_WORD_COST[route] * USD_PER_WORD;
      expect(usdCost("google/gemini-3.7-flash", shape)).toBeLessThanOrEqual(charged);
    }
  });
});

describe("model access", () => {
  it("keeps a downgraded workspace off the model it no longer pays for", () => {
    // The stored preference survives a downgrade; this is what stops it from
    // continuing to bill a Free workspace at a paid model's rate.
    expect(resolveWritingModel(PLANS.free, "xai/grok-4.6")).toBe(PLANS.free.models[0]);
    expect(resolveWritingModel(PLANS.pro, "xai/grok-4.6")).toBe("xai/grok-4.6");
  });

  it("falls back rather than throwing on a model that no longer exists", () => {
    expect(resolveWritingModel(PLANS.pro, "anthropic/claude-opus-5")).toBe(
      PLANS.pro.models[0],
    );
    expect(resolveWritingModel(PLANS.pro, null)).toBe(PLANS.pro.models[0]);
  });

  it("treats an unknown plan slug as Free", () => {
    expect(planFor("enterprise").slug).toBe("free");
    expect(planFor(null).slug).toBe("free");
  });

  it("offers only models that exist", () => {
    for (const plan of Object.values(PLANS)) {
      for (const id of plan.models) expect(MODEL_CATALOGUE[id]).toBeDefined();
    }
  });
});

describe("cost", () => {
  it("never bills cached or reasoning tokens twice", () => {
    // Both are subsets of a total that is already being charged. Adding them
    // on top would overstate every bill by the size of the reasoning.
    const plain = usdCost("google/gemini-3.7-flash", {
      inputTokens: 10_000,
      outputTokens: 1_000,
    });
    const detailed = usdCost("google/gemini-3.7-flash", {
      inputTokens: 10_000,
      outputTokens: 1_000,
      reasoningTokens: 900,
    });
    expect(detailed).toBe(plain);
  });

  it("charges cached input at the cached rate", () => {
    const cold = usdCost("anthropic/claude-haiku-4.5", { inputTokens: 10_000 });
    const warm = usdCost("anthropic/claude-haiku-4.5", {
      inputTokens: 10_000,
      cacheReadTokens: 9_000,
    });
    expect(warm).toBeLessThan(cold);
  });

  it("does not discount a model with no published cached rate", () => {
    // Grok reports cache reads but publishes no rate for them. Pricing them at
    // full input overstates our cost, which is the safe direction.
    const cold = usdCost("xai/grok-4.6", { inputTokens: 10_000 });
    const warm = usdCost("xai/grok-4.6", {
      inputTokens: 10_000,
      cacheReadTokens: 9_000,
    });
    expect(warm).toBe(cold);
  });

  it("is never negative, however the provider reports its subsets", () => {
    for (const id of Object.keys(MODEL_CATALOGUE) as ModelId[]) {
      expect(
        usdCost(id, {
          inputTokens: 100,
          outputTokens: 10,
          // Deliberately inconsistent: subsets larger than their total.
          cacheReadTokens: 5_000,
          cacheWriteTokens: 5_000,
        }),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("flattens the SDK's nested usage shape", () => {
    expect(
      toTokenUsage({
        inputTokens: 100,
        outputTokens: 20,
        inputTokenDetails: { cacheReadTokens: 40, cacheWriteTokens: 10 },
        outputTokenDetails: { reasoningTokens: 15 },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      reasoningTokens: 15,
    });
  });

  it("reads a missing detail as zero rather than NaN", () => {
    expect(toTokenUsage({ inputTokens: 5 })).toEqual({
      inputTokens: 5,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    });
  });
});

describe("countWords", () => {
  it("counts whitespace-separated runs", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  padded\n\nacross lines  ")).toBe(3);
  });

  it("is zero for nothing", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n  ")).toBe(0);
  });
});

describe("planChangeDirection", () => {
  /**
   * The direction decides when a change lands and whether money moves today,
   * so getting it backwards would charge somebody for a downgrade or hand out
   * a month of Pro for nothing.
   */
  it("reads price, in both directions", () => {
    expect(planChangeDirection("starter", "pro")).toBe("upgrade");
    expect(planChangeDirection("pro", "starter")).toBe("downgrade");
    expect(planChangeDirection("free", "starter")).toBe("upgrade");
    expect(planChangeDirection("team", "free")).toBe("downgrade");
  });

  it("calls a plan its own equal, which is how a scheduled change is undone", () => {
    expect(planChangeDirection("pro", "pro")).toBe("same");
  });

  it("agrees with the price list it is derived from", () => {
    const ordered = ["free", "starter", "pro", "team"] as const;
    for (let i = 1; i < ordered.length; i += 1) {
      expect(PLANS[ordered[i]].priceCents).toBeGreaterThan(
        PLANS[ordered[i - 1]].priceCents,
      );
      expect(planChangeDirection(ordered[i - 1], ordered[i])).toBe("upgrade");
    }
  });
});
