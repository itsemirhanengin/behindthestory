import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  canonChunks,
  chapterRevisions,
  chapters,
  getDb,
} from "@behindthestory/db";
import { indexChapter } from "@behindthestory/core/canon-index";

import { assertChapter, requireAuth, type AuthEnv } from "#middleware/auth";

/** Snapshots kept per chapter. Older ones are pruned beyond this. */
const MAX_REVISIONS = 40;

/** "" → "B" → "C" ... The original draft carries no label. */
function nextLabel(taken: string[]): string {
  for (let code = "B".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
    const label = String.fromCharCode(code);
    if (!taken.includes(label)) return label;
  }
  throw new HTTPException(400, {
    message: "This chapter already has every variant label A–Z.",
  });
}

/**
 * Loads a chapter the caller is allowed to touch. Every handler below starts
 * here, so a chapter id belonging to someone else is indistinguishable from one
 * that does not exist.
 */
async function loadChapter(userId: string, chapterId: string) {
  await assertChapter(userId, chapterId);
  const [chapter] = await getDb()
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  if (!chapter) throw new HTTPException(404, { message: "Chapter not found" });
  return chapter;
}

export const chapterRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  /**
   * Makes this variant the one that counts for its slot — what the reader, the
   * export and every AI context see.
   *
   * The siblings are stood down first: the partial unique index allows only one
   * active variant per slot, so activating before deactivating is rejected.
   */
  .post("/:chapterId/activate", async (c) => {
    const chapterId = c.req.param("chapterId");
    const chapter = await loadChapter(c.get("user").id, chapterId);
    if (chapter.isActive) return c.json(chapter);

    const db = getDb();
    await db
      .update(chapters)
      .set({ isActive: false })
      .where(
        and(
          eq(chapters.novelId, chapter.novelId),
          eq(chapters.number, chapter.number),
          ne(chapters.id, chapterId),
        ),
      );

    const [updated] = await db
      .update(chapters)
      .set({ isActive: true })
      .where(eq(chapters.id, chapterId))
      .returning();

    return c.json(updated);
  })
  /** Whether this chapter's prose is currently retrievable, and how stale it is. */
  .get("/:chapterId/index", async (c) => {
    const chapterId = c.req.param("chapterId");
    await assertChapter(c.get("user").id, chapterId);

    const [row] = await getDb()
      .select({
        chunks: sql<number>`count(*)::int`,
        indexedAt: sql<string | null>`max(${canonChunks.createdAt})`,
      })
      .from(canonChunks)
      .where(eq(canonChunks.sourceId, chapterId));
    return c.json(row ?? { chunks: 0, indexedAt: null });
  })
  .post("/:chapterId/index", async (c) => {
    const chapter = await loadChapter(c.get("user").id, c.req.param("chapterId"));

    try {
      const result = await indexChapter(chapter.novelId, chapter);
      return c.json({ ok: true, ...result });
    } catch (error) {
      console.error("[canon-index]", error);
      return c.json(
        {
          error:
            "Failed to index this chapter. Embeddings run through the AI provider — check model access and credits.",
        },
        502,
      );
    }
  })
  .get("/:chapterId/revisions", async (c) => {
    const chapterId = c.req.param("chapterId");
    await assertChapter(c.get("user").id, chapterId);

    const rows = await getDb()
      .select({
        id: chapterRevisions.id,
        label: chapterRevisions.label,
        wordCount: chapterRevisions.wordCount,
        createdAt: chapterRevisions.createdAt,
      })
      .from(chapterRevisions)
      .where(eq(chapterRevisions.chapterId, chapterId))
      .orderBy(desc(chapterRevisions.createdAt));
    return c.json(rows);
  })
  .post(
    "/:chapterId/revisions",
    zValidator(
      "json",
      z.object({
        label: z.string().max(120).default("manual"),
        /** Optional; when omitted the chapter's current content is snapshotted. */
        content: z.string().optional(),
      }),
    ),
    async (c) => {
      const chapterId = c.req.param("chapterId");
      const chapter = await loadChapter(c.get("user").id, chapterId);
      const body = c.req.valid("json");

      const content = body.content ?? chapter.content;
      if (!content.trim()) {
        return c.json({ error: "Nothing to snapshot — the chapter is empty." }, 400);
      }

      const db = getDb();
      const existing = await db
        .select({ id: chapterRevisions.id, content: chapterRevisions.content })
        .from(chapterRevisions)
        .where(eq(chapterRevisions.chapterId, chapterId))
        .orderBy(desc(chapterRevisions.createdAt));

      // Never stack identical snapshots — hitting "save version" twice in a row
      // should not bury the history.
      if (existing[0]?.content === content) {
        return c.json({ ok: true, unchanged: true });
      }

      const [row] = await db
        .insert(chapterRevisions)
        .values({
          chapterId,
          content,
          label: body.label,
          wordCount: content.trim() ? content.trim().split(/\s+/).length : 0,
        })
        .returning();

      for (const stale of existing.slice(MAX_REVISIONS - 1)) {
        await db.delete(chapterRevisions).where(eq(chapterRevisions.id, stale.id));
      }

      return c.json(row, 201);
    },
  )
  .get("/:chapterId/variants", async (c) => {
    const chapter = await loadChapter(c.get("user").id, c.req.param("chapterId"));

    const siblings = await getDb()
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.novelId, chapter.novelId),
          eq(chapters.number, chapter.number),
        ),
      );
    siblings.sort((a, b) => a.variantLabel.localeCompare(b.variantLabel));
    return c.json(siblings);
  })
  /**
   * Starts an alternative take of this chapter: same slot, same plan, empty
   * prose. Revisions are the history of one take; variants are parallel takes.
   */
  .post("/:chapterId/variants", async (c) => {
    const source = await loadChapter(c.get("user").id, c.req.param("chapterId"));
    const db = getDb();

    const siblings = await db
      .select({ variantLabel: chapters.variantLabel })
      .from(chapters)
      .where(
        and(
          eq(chapters.novelId, source.novelId),
          eq(chapters.number, source.number),
        ),
      );

    const [created] = await db
      .insert(chapters)
      .values({
        novelId: source.novelId,
        number: source.number,
        variantLabel: nextLabel(siblings.map((s) => s.variantLabel)),
        // The new take is inert until the author switches to it, which also
        // keeps the one-active-variant-per-slot index satisfied.
        isActive: false,
        act: source.act,
        title: source.title,
        outline: source.outline,
        beats: source.beats.map((b) => ({ ...b, done: false })),
        continuesFromPrevious: source.continuesFromPrevious,
        content: "",
        summary: "",
        status: "draft",
      })
      .returning();

    return c.json(created, 201);
  });
