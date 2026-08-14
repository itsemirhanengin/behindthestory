import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CHAR_STATUS_VALUES,
  EVENT_IMPACT_VALUES,
  REL_TYPE_VALUES,
  characters,
  getDb,
  relationships,
  storyEvents,
} from "@behindthestory/db";
import {
  loadStoryEvents,
  resolveChapterId,
} from "@behindthestory/core/story-events";
import {
  LATEST,
  type StoryEvent,
  allTransitions,
  causalTrace,
  describeTransition,
  eventsByRelationship,
  formatChapterRef,
  sortEvents,
} from "@behindthestory/core/story-state";

import { assertNovel, requireAuth, type AuthEnv } from "#middleware/auth";

/**
 * Events are authored by chapter *number*, not chapter id — that is how a
 * writer thinks about the spine, and it keeps an event placeable on a slot that
 * has not been written yet. The citation is resolved server-side.
 *
 * A row carries the full state after the event, so exactly one subject shape is
 * accepted: a relationship event states type and closeness, a character event
 * states status. The database rejects any other combination.
 */
const eventSchema = z.intersection(
  z.union([
    z.object({
      relationshipId: z.uuid(),
      type: z.enum(REL_TYPE_VALUES),
      closeness: z.number().int().min(1).max(10),
    }),
    z.object({
      characterId: z.uuid(),
      status: z.enum(CHAR_STATUS_VALUES),
    }),
  ]),
  z.object({
    chapterNumber: z.number().int().min(0),
    cause: z.string().default(""),
    driverCharacterIds: z.array(z.uuid()).default([]),
    impact: z.enum(EVENT_IMPACT_VALUES).default("major"),
    origin: z.enum(["user", "ai"]).default("user"),
  }),
);

export const novelTimelineRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  /**
   * The two questions a long novel makes expensive to answer:
   *
   *   ?chapter=128                     What changed in chapter 128, and for whom?
   *   ?relationshipId=…&asOf=685       Why are these two like this now?
   *
   * Both are served hydrated with names, because an id list is useless to the
   * author who is 500 chapters away from the event.
   */
  .get(
    "/:novelId/timeline",
    zValidator(
      "query",
      z.object({
        chapter: z.string().optional(),
        relationshipId: z.string().optional(),
        asOf: z.string().optional(),
      }),
    ),
    async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);

    const { chapter: chapterParam, relationshipId, asOf: asOfParam } = c.req.valid("query");
    const asOf = Number(asOfParam ?? LATEST);

    const db = getDb();
    const [cast, rels, events] = await Promise.all([
      db.select().from(characters).where(eq(characters.novelId, novelId)),
      db.select().from(relationships).where(eq(relationships.novelId, novelId)),
      loadStoryEvents(novelId),
    ]);

    const nameOf = (id: string) =>
      cast.find((ch) => ch.id === id)?.name ?? "(deleted character)";
    const pairOf = (id: string) => {
      const rel = rels.find((r) => r.id === id);
      return rel
        ? `${nameOf(rel.sourceCharacterId)} ↔ ${nameOf(rel.targetCharacterId)}`
        : "(deleted relationship)";
    };

    const describe = (event: StoryEvent) => ({
      id: event.id,
      chapterNumber: event.chapterNumber,
      chapterRef: formatChapterRef(event.chapterNumber),
      subject: event.relationshipId
        ? pairOf(event.relationshipId)
        : event.characterId
          ? nameOf(event.characterId)
          : "?",
      subjectKind: event.relationshipId
        ? ("relationship" as const)
        : ("character" as const),
      relationshipId: event.relationshipId,
      characterId: event.characterId,
      state: event.relationshipId
        ? `${event.relType}, closeness ${event.closeness}/10`
        : `${event.charStatus}`,
      cause: event.cause,
      drivenBy: event.driverCharacterIds.map(nameOf),
      impact: event.impact,
      origin: event.origin,
    });

    // "Why are these two like this now?" — the causal chain, not the full log.
    if (relationshipId) {
      const own = eventsByRelationship(events).get(relationshipId) ?? [];
      const steps = allTransitions(own, asOf);
      const traceIds = new Set(causalTrace(own, asOf).map((s) => s.event.id));
      return c.json({
        relationshipId,
        pair: pairOf(relationshipId),
        asOf: Number.isFinite(asOf) ? asOf : null,
        // Every transition, flagged with whether it earned a place in the
        // trace, so the UI can show the whole history and highlight what
        // explains it.
        transitions: steps.map((s) => ({
          ...describe(s.event),
          transition: describeTransition(s),
          isTurn: s.isTurn,
          inTrace: traceIds.has(s.event.id),
        })),
      });
    }

    // "What happened in chapter 128?"
    if (chapterParam !== undefined) {
      const chapterNumber = Number(chapterParam);
      if (!Number.isInteger(chapterNumber) || chapterNumber < 0) {
        return c.json({ error: "chapter must be a non-negative integer" }, 400);
      }
      return c.json({
        chapterNumber,
        events: sortEvents(
          events.filter((e) => e.chapterNumber === chapterNumber),
        ).map(describe),
      });
    }

    // Whole novel, chronological — the timeline view.
    return c.json({ events: sortEvents(events).map(describe) });
    },
  )
  .get("/:novelId/story-events", async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);

    const rows = await getDb()
      .select()
      .from(storyEvents)
      .where(eq(storyEvents.novelId, novelId));
    return c.json(rows);
  })
  .post("/:novelId/story-events", zValidator("json", eventSchema), async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);
    const body = c.req.valid("json");

    const db = getDb();
    const cast = await db
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.novelId, novelId));
    const castIds = new Set(cast.map((ch) => ch.id));

    // Both subject kinds must belong to this novel — the generic entity routes
    // scope by id alone, so this is the only place that can check it.
    if ("characterId" in body && !castIds.has(body.characterId)) {
      return c.json({ error: "character does not belong to this novel" }, 400);
    }
    if ("relationshipId" in body) {
      const [rel] = await db
        .select({ id: relationships.id })
        .from(relationships)
        .where(
          // Scoped to the novel, not just looked up by id: without the second
          // clause an event could cite a relationship from another manuscript.
          and(
            eq(relationships.id, body.relationshipId),
            eq(relationships.novelId, novelId),
          ),
        );
      if (!rel) return c.json({ error: "relationship not found" }, 404);
    }

    const shared = {
      novelId,
      chapterId: await resolveChapterId(novelId, body.chapterNumber),
      chapterNumber: body.chapterNumber,
      cause: body.cause,
      driverCharacterIds: body.driverCharacterIds.filter((id) => castIds.has(id)),
      impact: body.impact,
      origin: body.origin,
    };

    const [row] = await db
      .insert(storyEvents)
      .values(
        "relationshipId" in body
          ? {
              ...shared,
              relationshipId: body.relationshipId,
              relType: body.type,
              closeness: body.closeness,
            }
          : {
              ...shared,
              characterId: body.characterId,
              charStatus: body.status,
            },
      )
      .returning();

    return c.json(row, 201);
  });
