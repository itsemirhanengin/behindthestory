import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, novelDrafts, POV_VALUES, TENSE_VALUES } from "@behindthestory/db";
import type { StyleFields, WizardTurn } from "@behindthestory/core/onboarding";

import { requireAuth, type AuthEnv } from "#middleware/auth";
import { readingSchema, styleSchema } from "#routes/ai-onboarding";

/** The style contract as the author has edited it — `StyleProposal` minus the
 *  rationale, which never changes after the proposal. */
const styleFieldsSchema = z.object({
  genre: z.string().max(200),
  tone: z.string().max(500),
  pov: z.enum(POV_VALUES),
  tense: z.enum(TENSE_VALUES),
  targetChapterWords: z.number().int().min(200).max(20_000),
  styleNotes: z.string().max(20_000),
}) satisfies z.ZodType<StyleFields>;

const turnSchema = z.object({
  correction: z.string().max(4_000),
  changeNote: z.string().max(2_000),
}) satisfies z.ZodType<WizardTurn>;

/**
 * The whole wizard state, snapshotted rather than patched: the client owns the
 * document and the debounce means writes are rare, so a full body is simpler
 * than a merge and can never leave the row half of one session and half of
 * another. Limits mirror the routes that produced each piece.
 */
const draftSchema = z.object({
  step: z.number().int().min(0).max(3),
  maxStep: z.number().int().min(0).max(3),
  title: z.string().max(300).default(""),
  titleFromAi: z.boolean().default(false),
  description: z.string().max(40_000).default(""),
  reading: readingSchema.nullable().default(null),
  readingRevision: z.number().int().min(0).default(0),
  turns: z.array(turnSchema).max(24).default([]),
  style: styleFieldsSchema.nullable().default(null),
  styleProposal: styleSchema.nullable().default(null),
  styleFrom: z.number().int().min(-1).default(-1),
});

/**
 * A 404 rather than 403, matching `assertNovel`: whether a draft id exists at
 * all is not something another account gets to learn.
 */
async function ownDraft(userId: string, draftId: string) {
  const [row] = await getDb()
    .select()
    .from(novelDrafts)
    .where(and(eq(novelDrafts.id, draftId), eq(novelDrafts.userId, userId)));
  if (!row) throw new HTTPException(404, { message: "Draft not found" });
  return row;
}

/**
 * The new-novel wizard's autosave target, one row per unfinished novel.
 *
 * "New novel" is `POST /` — the row exists before the wizard renders, and the
 * wizard lives at the row's id, so an author can keep several novels
 * half-described at once. Publishing stays `POST /api/novels`; the wizard
 * deletes its draft after that succeeds.
 *
 * Mounted at `/api/novel-drafts` rather than under `/api/novels` because the
 * novels router's `/:novelId` routes would capture the path first.
 */
export const novelDraftRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const rows = await getDb()
      .select()
      .from(novelDrafts)
      .where(eq(novelDrafts.userId, c.get("user").id))
      .orderBy(desc(novelDrafts.updatedAt));
    return c.json(rows);
  })
  .post("/", async (c) => {
    // Born empty — every column has a default. The body would only be a way
    // for a client to smuggle in another draft's state, so there isn't one.
    const [row] = await getDb()
      .insert(novelDrafts)
      .values({ userId: c.get("user").id })
      .returning();
    return c.json(row, 201);
  })
  .get("/:draftId", async (c) => {
    const row = await ownDraft(c.get("user").id, c.req.param("draftId"));
    return c.json(row);
  })
  .put("/:draftId", zValidator("json", draftSchema), async (c) => {
    const draftId = c.req.param("draftId");
    await ownDraft(c.get("user").id, draftId);

    const [row] = await getDb()
      .update(novelDrafts)
      .set(c.req.valid("json"))
      .where(eq(novelDrafts.id, draftId))
      .returning();
    return c.json(row);
  })
  .delete("/:draftId", async (c) => {
    const draftId = c.req.param("draftId");
    await ownDraft(c.get("user").id, draftId);

    await getDb().delete(novelDrafts).where(eq(novelDrafts.id, draftId));
    return c.json({ ok: true });
  });
