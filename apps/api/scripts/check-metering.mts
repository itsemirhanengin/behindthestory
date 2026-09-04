/**
 * End-to-end check of the metering path against the real AI Gateway.
 *
 * The parts that cannot be verified any other way are exactly the parts most
 * likely to be wrong: whether the gateway recognises each model slug, and
 * whether the usage the SDK reports maps onto the cost formula the way the
 * pricing table assumes. Both are silent failures — a wrong slug looks like a
 * runtime error in production, and a misread usage shape just bills the wrong
 * amount forever.
 *
 * Spends real money: a few thousandths of a cent per model.
 *
 *   docker run -d --name bts-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=bts \
 *     -p 55432:5432 pgvector/pgvector:pg17
 *   docker run -d --name bts-test-redis -p 56379:6379 redis:7-alpine
 *   pnpm --filter @behindthestory/db db:migrate
 *
 *   DATABASE_URL="postgres://postgres:test@127.0.0.1:55432/bts?sslmode=disable" \
 *   REDIS_URL="redis://127.0.0.1:56379" \
 *   AI_GATEWAY_API_KEY="$(grep AI_GATEWAY_API_KEY .env | cut -d= -f2-)" \
 *     pnpm --filter @behindthestory/api check:metering
 */
import { generateText } from "ai";
import { eq } from "drizzle-orm";

import {
  aiGenerations,
  getDb,
  novels,
  users,
  wordLedger,
  workspaceMembers,
  workspaces,
} from "@behindthestory/db";
import { MODEL_CATALOGUE, type ModelId } from "@behindthestory/ai/models";
import { ensureBalance, readBalance } from "@behindthestory/core/word-balance";

import { openMeter, InsufficientWordsError } from "#lib/billing/meter";

const db = getDb();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

// --- fixture ---------------------------------------------------------------
const [user] = await db
  .insert(users)
  .values({
    email: `meter-${Date.now()}@example.com`,
    displayName: "Meter",
    // Handles are unique; the timestamp keeps repeated runs from colliding.
    username: `meter-${Date.now()}`,
  })
  .returning();
const [workspace] = await db
  .insert(workspaces)
  .values({ name: "Meter", slug: `meter-${Date.now()}` })
  .returning();
await db
  .insert(workspaceMembers)
  .values({ workspaceId: workspace.id, userId: user.id, role: "owner" });
await ensureBalance(workspace.id, "pro");
const [novel] = await db
  .insert(novels)
  .values({ workspaceId: workspace.id, ownerId: user.id, title: "Metering" })
  .returning();

// --- 1. every catalogue slug actually resolves at the gateway ---------------
console.log("\n1. gateway accepts each catalogue slug, and usage maps to cost");
for (const id of Object.keys(MODEL_CATALOGUE) as ModelId[]) {
  try {
    // Generous, because the reasoning models spend output tokens thinking
    // before they answer: at 64 the whole budget went to reasoning and the
    // visible text came back empty.
    const { text, usage } = await generateText({
      model: id,
      maxOutputTokens: 1_024,
      prompt: "Reply with exactly: ok",
    });
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    check(
      MODEL_CATALOGUE[id].label,
      Boolean(text.trim()) && input > 0 && output > 0,
      `in ${input} out ${output} reasoning ${usage.outputTokenDetails?.reasoningTokens ?? 0} cacheRead ${usage.inputTokenDetails?.cacheReadTokens ?? 0}`,
    );
  } catch (error) {
    check(MODEL_CATALOGUE[id].label, false, (error as Error).message.slice(0, 140));
  }
}

// --- 2. a metered generation writes a complete record -----------------------
console.log("\n2. a metered generation debits, records and settles");
{
  const before = await readBalance(workspace.id);
  const meter = await openMeter({
    userId: user.id,
    route: "character",
    novelId: novel.id,
  });

  const held = await readBalance(workspace.id);
  check(
    "reservation taken before the model runs",
    held!.wordsHeld === 200,
    `held ${held!.wordsHeld}`,
  );
  check("utility route pinned to the cheap model", meter.model === "google/gemini-3.7-flash", meter.model);

  const { usage } = await generateText({
    model: meter.model,
    maxOutputTokens: meter.maxOutputTokens,
    prompt: "Invent a one-sentence character description for a noir detective.",
  }).catch(meter.abort);

  await meter.settle({ usage });

  const [row] = await db
    .select()
    .from(aiGenerations)
    .where(eq(aiGenerations.requestId, meter.requestId));

  check("generation row written", Boolean(row));
  check("charged the published fixed price", row?.wordsCharged === 200, `${row?.wordsCharged}`);
  check("cost recorded", Number(row?.usdCost) > 0, `$${row?.usdCost}`);
  check("workspace attributed", row?.workspaceId === workspace.id);
  check("model recorded", row?.model === meter.model, row?.model);

  const after = await readBalance(workspace.id);
  check(
    "balance debited by exactly the price",
    before!.totalRemaining - after!.totalRemaining === 200,
    `${before!.totalRemaining} -> ${after!.totalRemaining}`,
  );
  check("nothing left reserved", after!.wordsHeld === 0);

  const ledger = await db
    .select({ reason: wordLedger.reason, delta: wordLedger.delta, gen: wordLedger.generationId })
    .from(wordLedger)
    .where(eq(wordLedger.requestId, meter.requestId));
  check(
    "hold and settle both recorded",
    ledger.length === 2 && ledger.some((l) => l.reason === "hold") && ledger.some((l) => l.reason === "settle"),
    ledger.map((l) => `${l.reason}:${l.delta}`).join(" "),
  );
  check(
    "settle points at the generation",
    ledger.some((l) => l.reason === "settle" && l.gen === row?.id),
  );
}

// --- 3. a failing generation gives the reservation back ---------------------
console.log("\n3. a failed generation releases its reservation");
{
  const before = await readBalance(workspace.id);
  const meter = await openMeter({ userId: user.id, route: "location", novelId: novel.id });
  await generateText({
    model: "google/this-model-does-not-exist" as ModelId,
    prompt: "hi",
  })
    .catch(meter.abort)
    .catch(() => {});
  const after = await readBalance(workspace.id);
  check("balance restored", after!.totalRemaining === before!.totalRemaining);
  check("nothing left reserved", after!.wordsHeld === 0);
}

// --- 4. hard stop -----------------------------------------------------------
console.log("\n4. an empty workspace cannot start a generation");
{
  const [broke] = await db
    .insert(workspaces)
    .values({ name: "Broke", slug: `broke-${Date.now()}` })
    .returning();
  await db.insert(workspaceMembers).values({ workspaceId: broke.id, userId: user.id, role: "owner" });
  await ensureBalance(broke.id, "free");
  const [emptyNovel] = await db
    .insert(novels)
    .values({ workspaceId: broke.id, ownerId: user.id, title: "Broke" })
    .returning();

  // Drain it.
  const drain = await openMeter({ userId: user.id, route: "chapter", novelId: emptyNovel.id });
  await drain.settle({ usage: { inputTokens: 1, outputTokens: 1 }, generatedWords: 10_000 });

  let thrown: unknown = null;
  try {
    await openMeter({ userId: user.id, route: "chapter", novelId: emptyNovel.id });
  } catch (error) {
    thrown = error;
  }
  check("402 raised", thrown instanceof InsufficientWordsError);
  check(
    "carries a machine-readable code",
    (thrown as InsufficientWordsError)?.code === "insufficient_words",
  );
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await db.$client.end();
process.exit(failures === 0 ? 0 : 1);
