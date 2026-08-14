import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";

import {
  EVENT_IMPACT_VALUES,
  REL_TYPE_VALUES,
  chapters,
  characterFacts,
  characters,
  getDb,
  locations,
  relationships,
  storyElements,
  storyEvents,
} from "@behindthestory/db";
import {
  loadStoryEvents,
  resolveChapterId,
} from "@behindthestory/core/story-events";
import { charactersAsOf } from "@behindthestory/core/story-state";

import { assertNovel, requireAuth, type AuthEnv } from "#middleware/auth";

export type SearchHit = {
  kind: "chapter" | "character" | "location" | "element" | "fact";
  id: string;
  /** Where to navigate. Empty for entities that open in a canvas. */
  href: string;
  title: string;
  subtitle: string;
  snippet: string;
};

/** A window of text around the match, so a hit is readable in the list. */
function snippet(text: string, query: string, width = 90): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return text.slice(0, width * 2).trim();
  const start = Math.max(0, at - width / 2);
  const end = Math.min(text.length, at + query.length + width);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** How many times the query occurs, so the best chapter sorts first. */
function countOccurrences(text: string, query: string): number {
  if (!query) return 0;
  let count = 0;
  let from = 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

/**
 * A bond cannot be created without saying what it was when it started — that
 * opening event is what every later "as of chapter N" read anchors to. This
 * route exists (rather than the generic entity one) purely to keep the
 * relationship and its first event from being writable apart.
 */
const relationshipSchema = z.object({
  sourceCharacterId: z.uuid(),
  targetCharacterId: z.uuid(),
  description: z.string().default(""),
  significance: z.string().default(""),
  origin: z.enum(["user", "ai"]).default("user"),

  // --- The opening event -------------------------------------------------
  type: z.enum(REL_TYPE_VALUES),
  closeness: z.number().int().min(1).max(10).default(5),
  /** 0 = "this is what they were before the novel opened". */
  startChapterNumber: z.number().int().min(0).default(0),
  cause: z.string().default(""),
  driverCharacterIds: z.array(z.uuid()).default([]),
  impact: z.enum(EVENT_IMPACT_VALUES).default("major"),
});

export const novelSearchRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  /**
   * Searches the whole novel — prose, cast, places and threads — in one pass.
   * "Where did I mention the broken seal?" is the question a novelist asks most
   * often, and until now the app had no answer for it.
   */
  .get(
    "/:novelId/search",
    zValidator("query", z.object({ q: z.string().optional() })),
    async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);

    const query = c.req.valid("query").q?.trim() ?? "";
    if (query.length < 2) return c.json({ hits: [] as SearchHit[] });

    const like = `%${query}%`;
    const db = getDb();

    const [chapterRows, characterRows, factRows, locationRows, elementRows] =
      await Promise.all([
        db
          .select()
          .from(chapters)
          .where(
            and(
              eq(chapters.novelId, novelId),
              or(
                ilike(chapters.content, like),
                ilike(chapters.title, like),
                ilike(chapters.summary, like),
                ilike(chapters.outline, like),
              ),
            ),
          ),
        db
          .select()
          .from(characters)
          .where(
            and(
              eq(characters.novelId, novelId),
              or(
                ilike(characters.name, like),
                ilike(characters.summary, like),
                ilike(characters.backstory, like),
                ilike(characters.secrets, like),
                ilike(characters.voice, like),
              ),
            ),
          ),
        db
          .select()
          .from(characterFacts)
          .where(
            and(
              eq(characterFacts.novelId, novelId),
              ilike(characterFacts.fact, like),
            ),
          ),
        db
          .select()
          .from(locations)
          .where(
            and(
              eq(locations.novelId, novelId),
              or(
                ilike(locations.name, like),
                ilike(locations.description, like),
                ilike(locations.significance, like),
              ),
            ),
          ),
        db
          .select()
          .from(storyElements)
          .where(
            and(
              eq(storyElements.novelId, novelId),
              or(
                ilike(storyElements.title, like),
                ilike(storyElements.description, like),
              ),
            ),
          ),
      ]);

    const characterName = new Map(characterRows.map((ch) => [ch.id, ch.name]));

    // Search spans the whole novel, so a character's *latest* status is the
    // right one to show — this is not a view pinned to a chapter.
    const stateById = charactersAsOf(
      characterRows,
      await loadStoryEvents(novelId),
    );

    const hits: SearchHit[] = [
      ...chapterRows
        .map((ch) => ({ chapter: ch, occurrences: countOccurrences(ch.content, query) }))
        .sort(
          (a, b) =>
            b.occurrences - a.occurrences || a.chapter.number - b.chapter.number,
        )
        .map(({ chapter: ch, occurrences }) => ({
          kind: "chapter" as const,
          id: ch.id,
          href: `/novels/${novelId}/write/${ch.id}`,
          title: `Chapter ${ch.number}${ch.variantLabel ? ` · take ${ch.variantLabel}` : ""}: ${ch.title}`,
          subtitle: occurrences > 1 ? `${occurrences} mentions` : "",
          snippet: snippet(ch.content || ch.summary, query),
        })),
      ...characterRows.map((ch) => ({
        kind: "character" as const,
        id: ch.id,
        href: `/novels/${novelId}/characters`,
        title: ch.name,
        subtitle: `${ch.role} · ${stateById.get(ch.id)?.status ?? "alive"}`,
        snippet: snippet(
          [ch.summary, ch.backstory, ch.secrets, ch.voice].filter(Boolean).join(" "),
          query,
        ),
      })),
      ...factRows.map((f) => ({
        kind: "fact" as const,
        id: f.id,
        href: `/novels/${novelId}/characters`,
        title: characterName.get(f.characterId) ?? "Character fact",
        subtitle: "established fact",
        snippet: snippet(f.fact, query),
      })),
      ...locationRows.map((l) => ({
        kind: "location" as const,
        id: l.id,
        href: `/novels/${novelId}/locations`,
        title: l.name,
        subtitle: l.atmosphere,
        snippet: snippet(
          [l.description, l.significance].filter(Boolean).join(" "),
          query,
        ),
      })),
      ...elementRows.map((e) => ({
        kind: "element" as const,
        id: e.id,
        href: `/novels/${novelId}/story`,
        title: e.title,
        subtitle: `${e.type.replace("_", " ")} · ${e.status}`,
        snippet: snippet(e.description, query),
      })),
    ];

    return c.json({ hits: hits.slice(0, 40) });
    },
  )
  .get("/:novelId/relationships", async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);

    const rows = await getDb()
      .select()
      .from(relationships)
      .where(eq(relationships.novelId, novelId));
    return c.json(rows);
  })
  .post(
    "/:novelId/relationships",
    zValidator("json", relationshipSchema),
    async (c) => {
      const novelId = c.req.param("novelId");
      await assertNovel(c.get("user").id, novelId);
      const body = c.req.valid("json");

      if (body.sourceCharacterId === body.targetCharacterId) {
        return c.json({ error: "a character cannot relate to itself" }, 400);
      }

      const db = getDb();
      const cast = await db
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.novelId, novelId));
      const castIds = new Set(cast.map((ch) => ch.id));
      if (
        !castIds.has(body.sourceCharacterId) ||
        !castIds.has(body.targetCharacterId)
      ) {
        return c.json({ error: "both characters must belong to this novel" }, 400);
      }

      // Resolve the citation from the chapter number, so the client only has to
      // know where on the spine the event sits.
      const chapterId = await resolveChapterId(novelId, body.startChapterNumber);

      // A real transaction, now that the driver supports one. This used to be an
      // insert followed by a compensating delete, which could still leave a bond
      // with no opening event — unreadable at any chapter — if the cleanup
      // itself failed.
      const created = await db.transaction(async (tx) => {
        const [relationship] = await tx
          .insert(relationships)
          .values({
            novelId,
            sourceCharacterId: body.sourceCharacterId,
            targetCharacterId: body.targetCharacterId,
            description: body.description,
            significance: body.significance,
            origin: body.origin,
          })
          .returning();

        const [event] = await tx
          .insert(storyEvents)
          .values({
            novelId,
            relationshipId: relationship.id,
            chapterId,
            chapterNumber: body.startChapterNumber,
            relType: body.type,
            closeness: body.closeness,
            cause: body.cause,
            driverCharacterIds: body.driverCharacterIds.filter((id) =>
              castIds.has(id),
            ),
            impact: body.impact,
            origin: body.origin,
          })
          .returning();

        return { relationship, event };
      });

      return c.json(created, 201);
    },
  );
