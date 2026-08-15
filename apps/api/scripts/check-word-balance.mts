/**
 * Integration check for the word balance engine.
 *
 * Needs a real Postgres because the properties worth checking are the ones
 * that only exist in the database: a conditional UPDATE that two concurrent
 * callers cannot both win, a unique index that turns a redelivered webhook
 * into a no-op. A mocked client would assert the mock.
 *
 * Point it at a throwaway database — it writes freely and cleans up nothing:
 *
 *   docker run -d --name bts-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=bts \
 *     -p 55432:5432 pgvector/pgvector:pg17
 *   pnpm --filter @behindthestory/db db:migrate
 *   DATABASE_URL="postgres://postgres:test@127.0.0.1:55432/bts?sslmode=disable" \
 *     pnpm --filter @behindthestory/api check:balance
 *
 * The concurrency case earns its keep: it caught a pool deadlock where the
 * insufficient-balance branch asked `getDb()` for a second connection while
 * still inside a transaction holding the first.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { getDb, wordLedger, workspaceBalances, workspaces } from "@behindthestory/db";
import {
  ensureBalance,
  grantTopupWords,
  holdWords,
  readBalance,
  releaseWords,
  settleWords,
  sweepStaleHolds,
} from "@behindthestory/core/word-balance";

const db = getDb();
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${ok ? "" : `\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`}`);
}

async function freshWorkspace(plan: "free" | "pro" = "free") {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: "test", slug: `t-${randomUUID().slice(0, 12)}` })
    .returning();
  await ensureBalance(ws.id, plan);
  return ws.id;
}

async function counters(id: string) {
  const b = await readBalance(id);
  return { plan: b!.planWordsRemaining, topup: b!.topupWordsRemaining, held: b!.wordsHeld };
}

// ---------------------------------------------------------------------------
console.log("\n1. seeding and simple hold/settle");
{
  const ws = await freshWorkspace("free"); // 10,000 plan words
  check("seeded", await counters(ws), { plan: 10_000, topup: 0, held: 0 });

  const req = randomUUID();
  const hold = await holdWords({ workspaceId: ws, requestId: req, words: 1_800 });
  check("hold succeeds", hold.ok, true);
  check("split all from plan", hold.ok && hold.split, { plan: 1_800, topup: 0 });
  check("after hold", await counters(ws), { plan: 8_200, topup: 0, held: 1_800 });

  await settleWords({
    workspaceId: ws,
    requestId: req,
    held: { plan: 1_800, topup: 0 },
    actualWords: 1_450,
  });
  check("settle refunds the difference", await counters(ws), {
    plan: 8_550, topup: 0, held: 0,
  });
}

// ---------------------------------------------------------------------------
console.log("\n2. hard stop: cannot spend past zero");
{
  const ws = await freshWorkspace("free");
  const ok = await holdWords({ workspaceId: ws, requestId: randomUUID(), words: 9_900 });
  check("large hold ok", ok.ok, true);
  const denied = await holdWords({ workspaceId: ws, requestId: randomUUID(), words: 500 });
  check("second hold denied", denied.ok, false);
  check("shortfall reported", !denied.ok && denied.shortfall, 400);
  check("nothing spent on denial", (await counters(ws)).plan, 100);
}

// ---------------------------------------------------------------------------
console.log("\n3. top-up words are refunded to the top-up counter, not the plan");
{
  const ws = await freshWorkspace("free");
  await grantTopupWords({ workspaceId: ws, words: 5_000, requestId: randomUUID() });
  check("granted", await counters(ws), { plan: 10_000, topup: 5_000, held: 0 });

  // Spend the plan down so the next hold has to straddle both counters.
  await holdWords({ workspaceId: ws, requestId: randomUUID(), words: 9_500 });

  const req = randomUUID();
  const hold = await holdWords({ workspaceId: ws, requestId: req, words: 2_000 });
  check("straddling split", hold.ok && hold.split, { plan: 500, topup: 1_500 });
  check("after straddle", await counters(ws), { plan: 0, topup: 3_500, held: 11_500 });

  await releaseWords({
    workspaceId: ws,
    requestId: req,
    held: { plan: 500, topup: 1_500 },
  });
  check("release restores each counter", await counters(ws), {
    plan: 500, topup: 5_000, held: 9_500,
  });
}

// ---------------------------------------------------------------------------
console.log("\n4. idempotency");
{
  const ws = await freshWorkspace("free");
  const req = randomUUID();
  await holdWords({ workspaceId: ws, requestId: req, words: 1_000 });
  await holdWords({ workspaceId: ws, requestId: req, words: 1_000 });
  check("duplicate hold is a no-op", await counters(ws), {
    plan: 9_000, topup: 0, held: 1_000,
  });

  await settleWords({ workspaceId: ws, requestId: req, held: { plan: 1_000, topup: 0 }, actualWords: 800 });
  await settleWords({ workspaceId: ws, requestId: req, held: { plan: 1_000, topup: 0 }, actualWords: 800 });
  check("duplicate settle is a no-op", await counters(ws), {
    plan: 9_200, topup: 0, held: 0,
  });

  const topupReq = `polar_order:${randomUUID()}`;
  await grantTopupWords({ workspaceId: ws, words: 30_000, requestId: topupReq });
  await grantTopupWords({ workspaceId: ws, words: 30_000, requestId: topupReq });
  check("redelivered order grants once", (await counters(ws)).topup, 30_000);
}

// ---------------------------------------------------------------------------
console.log("\n5. concurrency: 20 parallel holds against a 10-hold budget");
{
  const ws = await freshWorkspace("free"); // 10,000 words
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      holdWords({ workspaceId: ws, requestId: randomUUID(), words: 1_000 }),
    ),
  );
  const granted = results.filter((r) => r.ok).length;
  check("exactly 10 granted", granted, 10);
  check("balance floored at zero, not negative", await counters(ws), {
    plan: 0, topup: 0, held: 10_000,
  });
}

// ---------------------------------------------------------------------------
console.log("\n6. overrun: model wrote more than we held");
{
  const ws = await freshWorkspace("free");
  const req = randomUUID();
  await holdWords({ workspaceId: ws, requestId: req, words: 1_800 });
  await settleWords({
    workspaceId: ws, requestId: req,
    held: { plan: 1_800, topup: 0 }, actualWords: 2_500,
  });
  check("overrun charged, not forgiven", await counters(ws), {
    plan: 7_500, topup: 0, held: 0,
  });
}

// ---------------------------------------------------------------------------
console.log("\n7. stale hold sweep");
{
  const ws = await freshWorkspace("free");
  const abandoned = randomUUID();
  await holdWords({ workspaceId: ws, requestId: abandoned, words: 2_000 });

  const settled = randomUUID();
  await holdWords({ workspaceId: ws, requestId: settled, words: 1_000 });
  await settleWords({ workspaceId: ws, requestId: settled, held: { plan: 1_000, topup: 0 }, actualWords: 1_000 });

  // Age both holds past the sweep cutoff.
  await db.execute(sql`
    update word_ledger set created_at = now() - interval '30 minutes'
     where workspace_id = ${ws} and reason = 'hold'
  `);

  const before = await counters(ws);
  // Asserted on this workspace rather than the sweep's global count: the sweep
  // is deliberately not scoped to one workspace, so a count would depend on
  // whatever every earlier run left behind in the same database.
  await sweepStaleHolds(15 * 60 * 1000);
  check("abandoned hold returned to plan", (await counters(ws)).plan, before.plan + 2_000);
  check("settled hold not refunded twice", (await counters(ws)).held, 0);
}

// ---------------------------------------------------------------------------
console.log("\n8. ledger is a complete audit trail");
{
  const ws = await freshWorkspace("free");
  const req = randomUUID();
  await holdWords({ workspaceId: ws, requestId: req, words: 1_000, note: "chapter" });
  await settleWords({ workspaceId: ws, requestId: req, held: { plan: 1_000, topup: 0 }, actualWords: 900 });

  const rows = await db
    .select({ reason: wordLedger.reason, delta: wordLedger.delta, planAfter: wordLedger.planWordsAfter })
    .from(wordLedger)
    .where(eq(wordLedger.workspaceId, ws))
    .orderBy(wordLedger.createdAt);
  check("hold then settle recorded", rows.map((r) => `${r.reason}:${r.delta}`), [
    "hold:-1000", "settle:100",
  ]);
  check("running balance matches", rows.at(-1)!.planAfter, 9_100);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await db.$client.end();
process.exit(failures === 0 ? 0 : 1);
