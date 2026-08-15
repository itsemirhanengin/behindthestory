import { and, eq, lt, sql } from "drizzle-orm";

import {
  getDb,
  wordLedger,
  workspaceBalances,
  type WordLedgerReason,
  type WorkspaceBalance,
} from "@behindthestory/db";
import { PLANS, planFor, type PlanSlug } from "./plans";

/**
 * The word balance: reserve, settle, release.
 *
 * Everything here is written so that two generations starting at the same
 * instant cannot both spend the last thousand words. That rules out
 * read-then-write in application code, so the debit is a single conditional
 * UPDATE whose WHERE clause *is* the sufficiency check — if it matches no row,
 * there was not enough, and nothing was spent.
 *
 * Idempotency is the unique index on `(workspace_id, request_id, reason)`.
 * Every mutation writes its ledger row inside the same transaction as the
 * balance change, so a duplicate — a retried settle, a redelivered webhook —
 * violates the index, rolls the whole transaction back, and applies nothing.
 *
 * The two counters are spent plan-first and refunded to whichever they came
 * from, which is why every movement records its split rather than a single
 * total.
 */

const UNIQUE_VIOLATION = "23505";

function isDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: string }).code;
  if (code === UNIQUE_VIOLATION) return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause ? isDuplicate(cause) : false;
}

export type BalanceSnapshot = {
  planSlug: PlanSlug;
  planWordsRemaining: number;
  topupWordsRemaining: number;
  wordsHeld: number;
  totalRemaining: number;
  periodStart: Date;
  periodEnd: Date | null;
};

/**
 * Raw `execute` bypasses drizzle's column mapping, so these come back as the
 * snake_case strings Postgres sent.
 */
type BalanceRow = {
  workspace_id: string;
  plan_slug: string;
  plan_words_remaining: number;
  topup_words_remaining: number;
  words_held: number;
  period_start: Date;
  period_end: Date | null;
};

function snapshotRaw(row: BalanceRow): BalanceSnapshot {
  const plan = planFor(row.plan_slug);
  return {
    planSlug: plan.slug,
    planWordsRemaining: Number(row.plan_words_remaining),
    topupWordsRemaining: Number(row.topup_words_remaining),
    wordsHeld: Number(row.words_held),
    totalRemaining:
      Number(row.plan_words_remaining) + Number(row.topup_words_remaining),
    periodStart: row.period_start,
    periodEnd: row.period_end,
  };
}

function snapshot(row: WorkspaceBalance): BalanceSnapshot {
  const plan = planFor(row.planSlug);
  return {
    planSlug: plan.slug,
    planWordsRemaining: row.planWordsRemaining,
    topupWordsRemaining: row.topupWordsRemaining,
    wordsHeld: row.wordsHeld,
    totalRemaining: row.planWordsRemaining + row.topupWordsRemaining,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  };
}

/** One month from `from`, which is what every plan bills on. */
export function periodEndFrom(from: Date): Date {
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

/**
 * Creates the balance row for a workspace that has none, seeded with its
 * plan's allowance. Idempotent — an existing row is returned untouched, so
 * this is safe to call on every sign-in and from the backfill alike.
 */
export async function ensureBalance(
  workspaceId: string,
  planSlug: PlanSlug = "free",
): Promise<BalanceSnapshot> {
  const now = new Date();
  const [row] = await getDb()
    .insert(workspaceBalances)
    .values({
      workspaceId,
      planSlug,
      planWordsRemaining: PLANS[planSlug].monthlyWords,
      periodStart: now,
      periodEnd: periodEndFrom(now),
    })
    .onConflictDoNothing({ target: workspaceBalances.workspaceId })
    .returning();

  if (row) return snapshot(row);
  const existing = await readBalance(workspaceId);
  if (!existing) throw new Error(`No balance row for workspace ${workspaceId}`);
  return existing;
}

export async function readBalance(
  workspaceId: string,
): Promise<BalanceSnapshot | null> {
  const [row] = await getDb()
    .select()
    .from(workspaceBalances)
    .where(eq(workspaceBalances.workspaceId, workspaceId));
  return row ? snapshot(row) : null;
}

/** What a hold took from each counter, so it can be given back the same way. */
export type WordSplit = { plan: number; topup: number };

export type HoldResult =
  | { ok: true; split: WordSplit; balance: BalanceSnapshot }
  | { ok: false; balance: BalanceSnapshot | null; shortfall: number };

/**
 * Reserves words before a generation starts.
 *
 * Spend order is plan words first, then top-ups — the reverse would let a
 * paid-for pack drain while the allowance that resets anyway sat unused.
 *
 * The `prev` CTE reads the pre-update row in the same statement as the write,
 * so the split it reports is the split that actually happened; there is no
 * window between reading and deciding.
 */
export async function holdWords(input: {
  workspaceId: string;
  userId?: string | null;
  requestId: string;
  words: number;
  note?: string;
}): Promise<HoldResult> {
  const words = Math.max(0, Math.round(input.words));
  if (words === 0) {
    const balance = await readBalance(input.workspaceId);
    return balance
      ? { ok: true, split: { plan: 0, topup: 0 }, balance }
      : { ok: false, balance: null, shortfall: 0 };
  }

  try {
    return await getDb().transaction(async (tx) => {
      const { rows } = await tx.execute<
        BalanceRow & { prev_plan: number; prev_topup: number }
      >(sql`
        with prev as (
          select plan_words_remaining  as prev_plan,
                 topup_words_remaining as prev_topup
            from workspace_balances
           where workspace_id = ${input.workspaceId}
        )
        update workspace_balances b
           set plan_words_remaining  = greatest(b.plan_words_remaining - ${words}, 0),
               topup_words_remaining = b.topup_words_remaining
                                     - greatest(${words} - b.plan_words_remaining, 0),
               words_held            = b.words_held + ${words},
               updated_at            = now()
          from prev
         where b.workspace_id = ${input.workspaceId}
           and b.plan_words_remaining + b.topup_words_remaining >= ${words}
        returning b.*, prev.prev_plan, prev.prev_topup
      `);

      const updated = rows[0];
      if (!updated) {
        // Nothing was spent — the WHERE clause is the sufficiency check.
        //
        // Read the current figures through `tx`, never through `getDb()`. A
        // nested call would ask the pool for a second connection while this
        // transaction still holds the first, and under enough concurrency
        // every connection ends up waiting for one that will never come free.
        const { rows: current } = await tx.execute<BalanceRow>(sql`
          select * from workspace_balances where workspace_id = ${input.workspaceId}
        `);
        const balance = current[0] ? snapshotRaw(current[0]) : null;
        return {
          ok: false as const,
          balance,
          shortfall: words - (balance?.totalRemaining ?? 0),
        };
      }

      const split: WordSplit = {
        plan: Number(updated.prev_plan) - Number(updated.plan_words_remaining),
        topup:
          Number(updated.prev_topup) - Number(updated.topup_words_remaining),
      };

      await writeLedger(tx, {
        workspaceId: input.workspaceId,
        userId: input.userId,
        requestId: input.requestId,
        reason: "hold",
        planDelta: -split.plan,
        topupDelta: -split.topup,
        note: input.note,
        after: updated,
      });

      return { ok: true as const, split, balance: snapshotRaw(updated) };
    });
  } catch (error) {
    if (isDuplicate(error)) {
      // Same request already holds words. The transaction rolled back, so the
      // original hold still stands and nothing was double-charged.
      const balance = await readBalance(input.workspaceId);
      return balance
        ? { ok: true, split: { plan: 0, topup: 0 }, balance }
        : { ok: false, balance: null, shortfall: words };
    }
    throw error;
  }
}

/**
 * Converts a hold into the real charge once the generation is done.
 *
 * The refund goes back to the counters the hold drew from, plan first. A
 * generation that overran its estimate is allowed to push a counter negative:
 * the tokens are already spent, and pretending otherwise would mean giving
 * them away. The next hold simply fails.
 */
export async function settleWords(input: {
  workspaceId: string;
  userId?: string | null;
  requestId: string;
  held: WordSplit;
  actualWords: number;
  generationId?: string | null;
  note?: string;
}): Promise<BalanceSnapshot | null> {
  const heldTotal = input.held.plan + input.held.topup;
  const actual = Math.max(0, Math.round(input.actualWords));
  const refund = heldTotal - actual;

  // Refund unwinds the hold in reverse: top-ups were taken last, so they are
  // the first thing given back. An overrun is charged the same way round.
  const refundTopup = Math.max(Math.min(refund, input.held.topup), 0);
  const refundPlan = refund - refundTopup;

  return applyMovement(input.workspaceId, {
    userId: input.userId,
    requestId: input.requestId,
    reason: "settle",
    planDelta: refundPlan,
    topupDelta: refundTopup,
    releaseHeld: heldTotal,
    generationId: input.generationId,
    note: input.note,
  });
}

/** Gives a hold back untouched — the generation failed or the client hung up. */
export async function releaseWords(input: {
  workspaceId: string;
  userId?: string | null;
  requestId: string;
  held: WordSplit;
  note?: string;
}): Promise<BalanceSnapshot | null> {
  const heldTotal = input.held.plan + input.held.topup;
  if (heldTotal === 0) return readBalance(input.workspaceId);

  return applyMovement(input.workspaceId, {
    userId: input.userId,
    requestId: input.requestId,
    reason: "release",
    planDelta: input.held.plan,
    topupDelta: input.held.topup,
    releaseHeld: heldTotal,
    note: input.note,
  });
}

/**
 * Starts a new billing period: the plan allowance resets, top-ups carry over.
 *
 * `requestId` is derived from the subscription and period start by the caller,
 * so a webhook redelivered an hour later cannot grant a second month.
 */
export async function grantPlanWords(input: {
  workspaceId: string;
  planSlug: PlanSlug;
  requestId: string;
  periodStart: Date;
  periodEnd: Date | null;
  note?: string;
}): Promise<BalanceSnapshot | null> {
  const words = PLANS[input.planSlug].monthlyWords;

  try {
    return await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(workspaceBalances)
        .set({
          planSlug: input.planSlug,
          planWordsRemaining: words,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        })
        .where(eq(workspaceBalances.workspaceId, input.workspaceId))
        .returning();

      if (!updated) return null;

      await writeLedgerMapped(tx, {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
        reason: "grant",
        planDelta: words,
        topupDelta: 0,
        note: input.note ?? `${input.planSlug} period`,
        after: updated,
      });

      return snapshot(updated);
    });
  } catch (error) {
    if (isDuplicate(error)) return readBalance(input.workspaceId);
    throw error;
  }
}

/** Adds a purchased pack. Never expires, so it goes to the top-up counter. */
export async function grantTopupWords(input: {
  workspaceId: string;
  words: number;
  requestId: string;
  note?: string;
}): Promise<BalanceSnapshot | null> {
  const words = Math.max(0, Math.round(input.words));
  return applyMovement(input.workspaceId, {
    requestId: input.requestId,
    reason: "grant",
    planDelta: 0,
    topupDelta: words,
    note: input.note ?? "top-up",
  });
}

/**
 * Holds whose generation never reported back — a crashed container, a client
 * that hung up before the stream finished. Without this they stay reserved
 * forever and the workspace slowly loses its allowance to ghosts.
 */
export async function sweepStaleHolds(olderThanMs = 15 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const db = getDb();

  const stale = await db
    .select({
      workspaceId: wordLedger.workspaceId,
      userId: wordLedger.userId,
      requestId: wordLedger.requestId,
      planDelta: wordLedger.planDelta,
      topupDelta: wordLedger.topupDelta,
    })
    .from(wordLedger)
    .where(and(eq(wordLedger.reason, "hold"), lt(wordLedger.createdAt, cutoff)))
    .limit(500);

  let released = 0;
  for (const hold of stale) {
    // A hold that already settled or released has a matching row; those are
    // the ones to leave alone.
    const [resolved] = await db
      .select({ id: wordLedger.id })
      .from(wordLedger)
      .where(
        and(
          eq(wordLedger.workspaceId, hold.workspaceId),
          eq(wordLedger.requestId, hold.requestId),
          sql`${wordLedger.reason} in ('settle', 'release')`,
        ),
      );
    if (resolved) continue;

    await releaseWords({
      workspaceId: hold.workspaceId,
      userId: hold.userId,
      requestId: hold.requestId,
      held: { plan: -hold.planDelta, topup: -hold.topupDelta },
      note: "stale hold swept",
    });
    released += 1;
  }

  return { scanned: stale.length, released };
}

// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

type Movement = {
  userId?: string | null;
  requestId: string;
  reason: WordLedgerReason;
  planDelta: number;
  topupDelta: number;
  /** Words to take back out of `words_held`, for movements that close a hold. */
  releaseHeld?: number;
  generationId?: string | null;
  note?: string;
};

/**
 * One balance change plus its ledger row, in one transaction. The insert is
 * what enforces idempotency, so a duplicate takes the whole thing with it.
 */
async function applyMovement(
  workspaceId: string,
  move: Movement,
): Promise<BalanceSnapshot | null> {
  const held = Math.max(0, Math.round(move.releaseHeld ?? 0));

  try {
    return await getDb().transaction(async (tx) => {
      const { rows } = await tx.execute<BalanceRow>(sql`
        update workspace_balances
           set plan_words_remaining  = plan_words_remaining + ${move.planDelta},
               topup_words_remaining = topup_words_remaining + ${move.topupDelta},
               words_held            = greatest(words_held - ${held}, 0),
               updated_at            = now()
         where workspace_id = ${workspaceId}
        returning *
      `);

      const updated = rows[0];
      if (!updated) return null;

      await writeLedger(tx, {
        workspaceId,
        userId: move.userId,
        requestId: move.requestId,
        reason: move.reason,
        planDelta: move.planDelta,
        topupDelta: move.topupDelta,
        generationId: move.generationId,
        note: move.note,
        after: updated,
      });

      return snapshotRaw(updated);
    });
  } catch (error) {
    if (isDuplicate(error)) return readBalance(workspaceId);
    throw error;
  }
}

type LedgerWrite = {
  workspaceId: string;
  userId?: string | null;
  requestId: string;
  reason: WordLedgerReason;
  planDelta: number;
  topupDelta: number;
  generationId?: string | null;
  note?: string;
  after: BalanceRow;
};

async function writeLedger(tx: Tx, entry: LedgerWrite) {
  await tx.insert(wordLedger).values({
    workspaceId: entry.workspaceId,
    userId: entry.userId ?? null,
    delta: entry.planDelta + entry.topupDelta,
    planDelta: entry.planDelta,
    topupDelta: entry.topupDelta,
    reason: entry.reason,
    requestId: entry.requestId,
    generationId: entry.generationId ?? null,
    note: entry.note ?? "",
    planWordsAfter: Number(entry.after.plan_words_remaining),
    topupWordsAfter: Number(entry.after.topup_words_remaining),
  });
}

/** Same, for the paths whose UPDATE went through drizzle's column mapping. */
async function writeLedgerMapped(
  tx: Tx,
  entry: Omit<LedgerWrite, "after"> & { after: WorkspaceBalance },
) {
  await writeLedger(tx, {
    ...entry,
    after: {
      workspace_id: entry.after.workspaceId,
      plan_slug: entry.after.planSlug,
      plan_words_remaining: entry.after.planWordsRemaining,
      topup_words_remaining: entry.after.topupWordsRemaining,
      words_held: entry.after.wordsHeld,
      period_start: entry.after.periodStart,
      period_end: entry.after.periodEnd,
    },
  });
}
