import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, characters, relationships, type StoryEvent } from "@behindthestory/db";
import { loadStoryEvents } from "@behindthestory/core/story-events";
import {
  LATEST,
  allTransitions,
  causalTrace,
  describeTransition,
  eventsByRelationship,
  formatChapterRef,
  sortEvents,
} from "@behindthestory/core/story-state";

type Params = { params: Promise<{ novelId: string }> };

/**
 * The two questions a long novel makes expensive to answer:
 *
 *   ?chapter=128                     What changed in chapter 128, and for whom?
 *   ?relationshipId=…&asOf=685       Why are these two like this now?
 *
 * Both are served hydrated with names, because an id list is useless to the
 * author who is 500 chapters away from the event.
 */
export async function GET(req: Request, { params }: Params) {
  const { novelId } = await params;
  const url = new URL(req.url);
  const chapterParam = url.searchParams.get("chapter");
  const relationshipId = url.searchParams.get("relationshipId");
  const asOf = Number(url.searchParams.get("asOf") ?? LATEST);

  const db = getDb();
  const [cast, rels, events] = await Promise.all([
    db.select().from(characters).where(eq(characters.novelId, novelId)),
    db.select().from(relationships).where(eq(relationships.novelId, novelId)),
    loadStoryEvents(novelId),
  ]);

  const nameOf = (id: string) =>
    cast.find((c) => c.id === id)?.name ?? "(deleted character)";
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
    const trace = causalTrace(own, asOf);
    const traceIds = new Set(trace.map((s) => s.event.id));
    return NextResponse.json({
      relationshipId,
      pair: pairOf(relationshipId),
      asOf: Number.isFinite(asOf) ? asOf : null,
      // Every transition, flagged with whether it earned a place in the trace,
      // so the UI can show the whole history and highlight what explains it.
      transitions: steps.map((s) => ({
        ...describe(s.event),
        transition: describeTransition(s),
        isTurn: s.isTurn,
        inTrace: traceIds.has(s.event.id),
      })),
    });
  }

  // "What happened in chapter 128?"
  if (chapterParam !== null) {
    const chapterNumber = Number(chapterParam);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 0) {
      return NextResponse.json(
        { error: "chapter must be a non-negative integer" },
        { status: 400 },
      );
    }
    const atChapter = events.filter((e) => e.chapterNumber === chapterNumber);
    return NextResponse.json({
      chapterNumber,
      events: sortEvents(atChapter).map(describe),
    });
  }

  // Whole novel, chronological — the timeline view.
  return NextResponse.json({ events: sortEvents(events).map(describe) });
}
