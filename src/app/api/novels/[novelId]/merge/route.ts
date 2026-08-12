import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getDb,
  chapters,
  storyElements,
  relationships,
  storyEvents,
  characters,
  characterFacts,
  REL_TYPE_VALUES,
  CHAR_STATUS_VALUES,
  EVENT_IMPACT_VALUES,
} from "@/db";
import {
  eventKey,
  loadStoryEvents,
  normalizeText as normalize,
} from "@/lib/story-events";
import { eventsByCharacter, characterStateAsOf } from "@/lib/story-state";

type Params = { params: Promise<{ novelId: string }> };

const bodySchema = z.object({
  chapterId: z.uuid().optional(),
  chapterSummary: z.string().optional(),
  newElements: z
    .array(
      z.object({
        type: z.enum(["twist", "foreshadowing", "plot_thread", "event"]),
        title: z.string().min(1),
        description: z.string().default(""),
        relatedCharacterIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  resolvedElementIds: z.array(z.string()).default([]),
  relationshipUpdates: z
    .array(
      z.object({
        relationshipId: z.string(),
        newType: z.enum(REL_TYPE_VALUES),
        closeness: z.number(),
        cause: z.string().default(""),
        driverCharacterIds: z.array(z.string()).default([]),
        impact: z.enum(EVENT_IMPACT_VALUES).default("major"),
      }),
    )
    .default([]),
  characterStatusChanges: z
    .array(
      z.object({
        characterId: z.string(),
        newStatus: z.enum(CHAR_STATUS_VALUES),
        cause: z.string().default(""),
        driverCharacterIds: z.array(z.string()).default([]),
        impact: z.enum(EVENT_IMPACT_VALUES).default("pivotal"),
      }),
    )
    .default([]),
  newRelationships: z
    .array(
      z.object({
        sourceCharacterId: z.string(),
        targetCharacterId: z.string(),
        type: z.enum(REL_TYPE_VALUES),
        closeness: z.number().default(5),
        description: z.string().default(""),
        cause: z.string().default(""),
        impact: z.enum(EVENT_IMPACT_VALUES).default("major"),
      }),
    )
    .default([]),
  characterFacts: z
    .array(z.object({ characterId: z.string(), fact: z.string().min(1) }))
    .default([]),
});

const clampCloseness = (n: number) => Math.max(1, Math.min(10, Math.round(n)));

/**
 * Applies the author-approved subset of a chapter analysis to the story bible.
 *
 * Re-running the same analysis must not duplicate anything, so every write is
 * guarded against what the bible already holds. The neon-http driver cannot run
 * interactive transactions, so this is sequential and reports what it applied.
 */
export async function POST(req: Request, { params }: Params) {
  const { novelId } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid request: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    );
  }
  const {
    chapterId,
    chapterSummary,
    newElements,
    resolvedElementIds,
    relationshipUpdates,
    characterStatusChanges,
    newRelationships,
    characterFacts: facts,
  } = parsed.data;

  const db = getDb();
  const applied: string[] = [];
  const skipped: string[] = [];

  // Current state of this novel, used to reject duplicates and foreign ids.
  const [existingElements, existingRels, existingChars, existingFacts, existingEvents] =
    await Promise.all([
      db.select().from(storyElements).where(eq(storyElements.novelId, novelId)),
      db.select().from(relationships).where(eq(relationships.novelId, novelId)),
      db.select().from(characters).where(eq(characters.novelId, novelId)),
      db.select().from(characterFacts).where(eq(characterFacts.novelId, novelId)),
      loadStoryEvents(novelId),
    ]);

  const characterIds = new Set(existingChars.map((c) => c.id));

  // Events are anchored to a chapter *number*; without a chapter there is
  // nowhere on the spine to put them, so those parts of the merge are refused
  // rather than silently dropped onto chapter 0.
  const chapterNumber = chapterId
    ? ((
        await db
          .select({ number: chapters.number })
          .from(chapters)
          .where(eq(chapters.id, chapterId))
      )[0]?.number ?? null)
    : null;
  const eventKeys = new Set(existingEvents.map((e) => eventKey(e)));
  const charEventsById = eventsByCharacter(existingEvents);
  const elementTitles = new Set(existingElements.map((e) => normalize(e.title)));
  const elementIds = new Map(existingElements.map((e) => [e.id, e]));
  const relById = new Map(existingRels.map((r) => [r.id, r]));
  const relPairs = new Set(
    existingRels.flatMap((r) => [
      `${r.sourceCharacterId}:${r.targetCharacterId}`,
      `${r.targetCharacterId}:${r.sourceCharacterId}`,
    ]),
  );
  const factKeys = new Set(
    existingFacts.map((f) => `${f.characterId}:${normalize(f.fact)}`),
  );

  if (chapterSummary && chapterId) {
    await db
      .update(chapters)
      .set({ summary: chapterSummary })
      .where(eq(chapters.id, chapterId));
    applied.push("chapterSummary");
  }

  for (const el of newElements) {
    const key = normalize(el.title);
    if (elementTitles.has(key)) {
      skipped.push(`duplicate element: ${el.title}`);
      continue;
    }
    elementTitles.add(key);
    await db.insert(storyElements).values({
      novelId,
      type: el.type,
      title: el.title,
      description: el.description,
      relatedCharacterIds: el.relatedCharacterIds.filter((id) =>
        characterIds.has(id),
      ),
      introducedInChapterId: chapterId ?? null,
      status: "planted",
      origin: "ai",
    });
    applied.push(`newElement:${el.title}`);
  }

  for (const id of resolvedElementIds) {
    const element = elementIds.get(id);
    if (!element) {
      skipped.push(`unknown element: ${id}`);
      continue;
    }
    if (element.status === "resolved") {
      skipped.push(`already resolved: ${element.title}`);
      continue;
    }
    await db
      .update(storyElements)
      .set({ status: "resolved", resolvedInChapterId: chapterId ?? null })
      .where(eq(storyElements.id, id));
    applied.push(`resolved:${element.title}`);
  }

  // A relationship change is a new point on the timeline, never an edit of the
  // row — overwriting would erase the state the bond had for the chapters before
  // this one, which is the whole thing this table exists to keep.
  for (const upd of relationshipUpdates) {
    const rel = relById.get(upd.relationshipId);
    if (!rel) {
      skipped.push(`unknown relationship: ${upd.relationshipId}`);
      continue;
    }
    if (chapterNumber === null) {
      skipped.push(
        `relationship change needs a chapter to anchor to: ${upd.relationshipId}`,
      );
      continue;
    }
    const key = eventKey({
      relationshipId: upd.relationshipId,
      chapterNumber,
      cause: upd.cause,
    });
    if (eventKeys.has(key)) {
      skipped.push(`relationship change already recorded: ${upd.relationshipId}`);
      continue;
    }
    eventKeys.add(key);
    await db.insert(storyEvents).values({
      novelId,
      relationshipId: upd.relationshipId,
      chapterId,
      chapterNumber,
      relType: upd.newType,
      closeness: clampCloseness(upd.closeness),
      cause: upd.cause,
      driverCharacterIds: upd.driverCharacterIds.filter((id) =>
        characterIds.has(id),
      ),
      impact: upd.impact,
      origin: "ai",
    });
    applied.push(`relEvent:${upd.relationshipId}`);
  }

  for (const change of characterStatusChanges) {
    if (!characterIds.has(change.characterId)) {
      skipped.push("status change references an unknown character");
      continue;
    }
    if (chapterNumber === null) {
      skipped.push(
        `status change needs a chapter to anchor to: ${change.characterId}`,
      );
      continue;
    }
    // Restating the status a character already has adds a turning point where
    // the story had none, so it is refused even when the cause differs.
    const current = characterStateAsOf(
      charEventsById.get(change.characterId) ?? [],
      chapterNumber,
    );
    if (current.status === change.newStatus) {
      skipped.push(
        `${change.characterId} is already ${change.newStatus} at this point`,
      );
      continue;
    }
    const key = eventKey({
      characterId: change.characterId,
      chapterNumber,
      cause: change.cause,
    });
    if (eventKeys.has(key)) {
      skipped.push(`status change already recorded: ${change.characterId}`);
      continue;
    }
    eventKeys.add(key);
    const [inserted] = await db
      .insert(storyEvents)
      .values({
        novelId,
        characterId: change.characterId,
        chapterId,
        chapterNumber,
        charStatus: change.newStatus,
        cause: change.cause,
        driverCharacterIds: change.driverCharacterIds.filter((id) =>
          characterIds.has(id),
        ),
        impact: change.impact,
        origin: "ai",
      })
      .returning();
    // Keep the local timeline current so two changes for the same character in
    // one payload are judged against each other, not against the stale state.
    charEventsById.set(change.characterId, [
      ...(charEventsById.get(change.characterId) ?? []),
      inserted,
    ]);
    applied.push(`statusEvent:${change.characterId}`);
  }

  for (const rel of newRelationships) {
    const pair = `${rel.sourceCharacterId}:${rel.targetCharacterId}`;
    if (
      !characterIds.has(rel.sourceCharacterId) ||
      !characterIds.has(rel.targetCharacterId)
    ) {
      skipped.push("relationship references an unknown character");
      continue;
    }
    if (rel.sourceCharacterId === rel.targetCharacterId) {
      skipped.push("self-relationship");
      continue;
    }
    if (relPairs.has(pair)) {
      skipped.push(`relationship already exists: ${pair}`);
      continue;
    }
    relPairs.add(pair);
    relPairs.add(`${rel.targetCharacterId}:${rel.sourceCharacterId}`);
    const [created] = await db
      .insert(relationships)
      .values({
        novelId,
        sourceCharacterId: rel.sourceCharacterId,
        targetCharacterId: rel.targetCharacterId,
        description: rel.description,
        origin: "ai",
      })
      .returning();
    // The bond is unreadable at any chapter until its opening event exists, so
    // a failure here has to take the row with it.
    try {
      await db.insert(storyEvents).values({
        novelId,
        relationshipId: created.id,
        chapterId,
        chapterNumber: chapterNumber ?? 0,
        relType: rel.type,
        closeness: clampCloseness(rel.closeness),
        cause: rel.cause,
        impact: rel.impact,
        origin: "ai",
      });
    } catch (error) {
      await db.delete(relationships).where(eq(relationships.id, created.id));
      skipped.push(
        `could not open the timeline for ${pair}: ${(error as Error).message}`,
      );
      continue;
    }
    applied.push(`newRel:${pair}`);
  }

  // Facts land in their own table rather than being appended to `backstory`,
  // so a merge stays reversible and the authored backstory is never rewritten.
  for (const fact of facts) {
    if (!characterIds.has(fact.characterId)) {
      skipped.push("fact references an unknown character");
      continue;
    }
    const key = `${fact.characterId}:${normalize(fact.fact)}`;
    if (factKeys.has(key)) {
      skipped.push(`duplicate fact for ${fact.characterId}`);
      continue;
    }
    factKeys.add(key);
    await db.insert(characterFacts).values({
      novelId,
      characterId: fact.characterId,
      chapterId: chapterId ?? null,
      fact: fact.fact,
      origin: "ai",
    });
    applied.push(`fact:${fact.characterId}`);
  }

  return NextResponse.json({ ok: true, applied, skipped });
}
