import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { getDb, workspaces } from "@behindthestory/db";
import {
  UTILITY_MODEL,
  recordGeneration,
  toTokenUsage,
  type ModelId,
  type TokenUsage,
} from "@behindthestory/ai";
import {
  estimateWordsForRoute,
  isProseRoute,
  maxOutputTokensForRoute,
  planFor,
  resolveWritingModel,
  wordsForRoute,
  type Plan,
} from "@behindthestory/core/plans";
import {
  ensureBalance,
  holdWords,
  releaseWords,
  settleWords,
  type WordSplit,
} from "@behindthestory/core/word-balance";

import { rateLimit } from "#lib/auth/rate-limit";
import { workspaceIdForNovel } from "#lib/auth/workspace";

/**
 * Reserve, then settle or release.
 *
 * A generation cannot be priced before it runs — a chapter draft might come
 * back at 400 words or 2,400 — but it also cannot be allowed to run on an
 * empty balance and be billed afterwards, because by then the tokens are
 * spent. So the meter holds an estimate up front, and the difference is
 * reconciled once the real figures are in.
 *
 * Every path out of a generation has to reach `settle` or `release`. The one
 * that is easy to miss is the writer closing the tab mid-stream, which is why
 * `proseStreamResponse` grew an `onSettled` hook.
 */

/** 402 with a machine-readable code, so the studio can open the right dialog. */
export class InsufficientWordsError extends HTTPException {
  readonly code = "insufficient_words";

  constructor(
    readonly detail: { required: number; remaining: number; planSlug: string },
  ) {
    super(402, {
      message:
        "This workspace is out of words. Upgrade the plan or buy a top-up to keep writing.",
    });
  }
}

export type Meter = {
  /** The model this generation must run on. */
  model: ModelId;
  /** Pass to the model call — the ceiling the fixed prices assume. */
  maxOutputTokens: number;
  workspaceId: string;
  /** Shared by the generation row and both of its ledger rows. */
  requestId: string;
  /** Charge the real usage and record the generation. */
  settle(input: {
    usage: Parameters<typeof toTokenUsage>[0] | TokenUsage;
    /** Words produced, for prose routes. Ignored by fixed-price routes. */
    generatedWords?: number;
    chapterId?: string | null;
    /**
     * Overrides the route recorded on the row. The chapter endpoint only
     * learns whether it is writing a beat after it has built the context,
     * which is after the reservation was already sized — and both variants
     * price identically, so refining the label at settle costs nothing.
     */
    route?: string;
  }): Promise<void>;
  /** Give the reservation back. Safe to call after `settle` — it no-ops. */
  release(): Promise<void>;
  /**
   * Releases the reservation and rethrows. Written to be used as
   * `generateText({...}).catch(meter.abort)`, which is the only form that
   * attaches to an existing call without reindenting a block full of
   * multi-line prompt literals.
   *
   * Only the model call needs it. Anything after has already cost us the
   * tokens, so a failure there must still be charged — which is why `settle`
   * belongs immediately after the call and not at the end of the handler.
   */
  abort: (error: unknown) => Promise<never>;
};

type OpenMeterInput = {
  userId: string;
  route: string;
  /** Novel the generation belongs to; also how the workspace is resolved. */
  novelId?: string | null;
  /** Used when there is no novel yet, as in the new-novel wizard. */
  workspaceId?: string;
  /** Sizes the reservation for a chapter draft. */
  targetChapterWords?: number;
};

/** Whether the value came from `toTokenUsage` already. */
function normaliseUsage(
  usage: Parameters<typeof toTokenUsage>[0] | TokenUsage,
): TokenUsage {
  return "inputTokenDetails" in usage || "outputTokenDetails" in usage
    ? toTokenUsage(usage as Parameters<typeof toTokenUsage>[0])
    : (usage as TokenUsage);
}

async function loadWorkspacePlan(
  workspaceId: string,
): Promise<{ plan: Plan; defaultModel: string | null }> {
  const [row] = await getDb()
    .select({ defaultModel: workspaces.defaultModel })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));

  const balance = await ensureBalance(workspaceId);
  return { plan: planFor(balance.planSlug), defaultModel: row?.defaultModel ?? null };
}

export async function openMeter(input: OpenMeterInput): Promise<Meter> {
  const workspaceId =
    input.workspaceId ??
    (input.novelId ? await workspaceIdForNovel(input.novelId) : null);

  if (!workspaceId) {
    // Ownership was already asserted, so this is a novel that never got a
    // workspace — unreachable in practice, and not something to bill blindly.
    throw new HTTPException(409, {
      message: "This novel has no workspace. Run the workspace backfill.",
    });
  }

  const { plan, defaultModel } = await loadWorkspacePlan(workspaceId);

  /**
   * A second ceiling, alongside the word balance.
   *
   * Words bound what a workspace can spend; this bounds how fast. They catch
   * different things: a script hammering the cheapest route stays under the
   * word cap for a long time while doing real damage to latency for everyone
   * else. Scoped to the workspace rather than the user so a Team cannot buy
   * its way around it by adding seats.
   */
  const throttle = await rateLimit(
    `ai:${workspaceId}`,
    plan.rateLimit.limit,
    plan.rateLimit.windowSeconds,
  );
  if (!throttle.allowed) {
    throw new HTTPException(429, {
      message: `Too many AI requests. Try again in ${throttle.retryAfter} second${
        throttle.retryAfter === 1 ? "" : "s"
      }.`,
    });
  }

  // Extraction and critique stay on the utility model whatever the writer
  // picked, which is what lets those routes carry a fixed published price.
  const model = isProseRoute(input.route)
    ? resolveWritingModel(plan, defaultModel)
    : UTILITY_MODEL;

  const requestId = randomUUID();
  const estimate = estimateWordsForRoute(input.route, {
    targetChapterWords: input.targetChapterWords,
  });

  const hold = await holdWords({
    workspaceId,
    userId: input.userId,
    requestId,
    words: estimate,
    note: input.route,
  });

  if (!hold.ok) {
    throw new InsufficientWordsError({
      required: estimate,
      remaining: hold.balance?.totalRemaining ?? 0,
      planSlug: hold.balance?.planSlug ?? plan.slug,
    });
  }

  const held: WordSplit = hold.split;
  const started = Date.now();
  let closed = false;

  const release = async () => {
    if (closed) return;
    closed = true;
    await releaseWords({
      workspaceId,
      userId: input.userId,
      requestId,
      held,
      note: `${input.route} released`,
    });
  };

  return {
    model,
    maxOutputTokens: maxOutputTokensForRoute(input.route),
    workspaceId,
    requestId,
    release,

    abort: async (error: unknown): Promise<never> => {
      await release();
      throw error;
    },

    async settle({ usage, generatedWords = 0, chapterId, route }) {
      if (closed) return;
      closed = true;

      const settledRoute = route ?? input.route;
      const tokens = normaliseUsage(usage);
      const charged = wordsForRoute(settledRoute, generatedWords);

      // Recorded before the balance moves: the ledger row points at this
      // generation, and a settle that charged for a generation with no record
      // is the one shape support cannot explain.
      const generationId = await recordGeneration({
        workspaceId,
        userId: input.userId,
        novelId: input.novelId ?? null,
        chapterId: chapterId ?? null,
        route: input.route,
        model,
        usage: tokens,
        wordsCharged: charged,
        durationMs: Date.now() - started,
        requestId,
      });

      await settleWords({
        workspaceId,
        userId: input.userId,
        requestId,
        held,
        actualWords: charged,
        generationId,
        note: input.route,
      });
    },

  };
}
