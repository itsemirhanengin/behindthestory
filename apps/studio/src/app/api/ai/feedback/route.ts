import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { aiSuggestionFeedback, getDb } from "@behindthestory/db";

const decisionSchema = z.object({
  suggestionId: z.string().uuid(),
  novelId: z.string().uuid(),
  chapterId: z.string().uuid(),
  decision: z.enum(["accepted", "rejected"]),
  mode: z.enum(["insert", "replace"]),
  route: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  suggestionText: z.string().min(1).max(100_000),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
});

const feedbackSchema = z.object({
  id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2_000).default(""),
});

function shouldRequestFeedback(
  decision: "accepted" | "rejected",
  decisionCount: number,
) {
  if (decisionCount === 1) return true;
  return decision === "rejected"
    ? decisionCount % 3 === 0
    : decisionCount % 9 === 0;
}

/** Record every accept/reject so sampling remains stable across sessions. */
export async function POST(req: Request) {
  const parsed = decisionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feedback event" }, { status: 400 });
  }

  const db = getDb();
  const input = parsed.data;
  const [existing] = await db
    .select({
      id: aiSuggestionFeedback.id,
      feedbackPrompted: aiSuggestionFeedback.feedbackPrompted,
    })
    .from(aiSuggestionFeedback)
    .where(eq(aiSuggestionFeedback.suggestionId, input.suggestionId));

  if (existing) {
    return NextResponse.json({
      id: existing.id,
      shouldPrompt: existing.feedbackPrompted,
    });
  }

  const [totals] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiSuggestionFeedback)
    .where(
      and(
        eq(aiSuggestionFeedback.novelId, input.novelId),
        eq(aiSuggestionFeedback.decision, input.decision),
      ),
    );
  const decisionCount = (totals?.count ?? 0) + 1;
  const feedbackPrompted = shouldRequestFeedback(
    input.decision,
    decisionCount,
  );

  const [row] = await db
    .insert(aiSuggestionFeedback)
    .values({ ...input, feedbackPrompted })
    .returning({ id: aiSuggestionFeedback.id });

  return NextResponse.json(
    { id: row.id, shouldPrompt: feedbackPrompted, decisionCount },
    { status: 201 },
  );
}

/** Attach the optional sampled rating and written feedback to its decision. */
export async function PATCH(req: Request) {
  const parsed = feedbackSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
  }

  const db = getDb();
  const [row] = await db
    .update(aiSuggestionFeedback)
    .set({
      rating: parsed.data.rating,
      comment: parsed.data.comment || null,
      feedbackSubmittedAt: new Date(),
    })
    .where(eq(aiSuggestionFeedback.id, parsed.data.id))
    .returning({ id: aiSuggestionFeedback.id });

  if (!row) {
    return NextResponse.json({ error: "Feedback event not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
