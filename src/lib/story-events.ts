/**
 * Server-side helpers for writing to the event log. Reading and folding events
 * is `story-state.ts`, which stays free of database access so the client can
 * use it too.
 */
import { and, eq } from "drizzle-orm";
import { getDb, chapters, storyEvents, type StoryEvent } from "@/db";

/**
 * The active chapter occupying a slot, or null.
 *
 * Null is a valid, expected outcome — chapter 0 means "before the novel opened"
 * and has no chapter to cite, and an event may be anchored to a slot that has
 * not been written yet. `chapterNumber` is what ordering relies on either way.
 */
export async function resolveChapterId(
  novelId: string,
  chapterNumber: number,
): Promise<string | null> {
  if (chapterNumber <= 0) return null;
  const db = getDb();
  const [row] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        eq(chapters.number, chapterNumber),
        eq(chapters.isActive, true),
      ),
    );
  return row?.id ?? null;
}

/** Loose match, so "The locked door" and "the locked door." count as the same. */
export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Identity of an event for duplicate detection: the same subject, changed at
 * the same point on the spine, for the same stated reason.
 *
 * Re-running an analysis on a chapter must not stack a second copy of the same
 * turning point onto the timeline, which would double-count it in the "why"
 * trace and make the bond's history read as two separate reversals.
 */
export function eventKey(event: {
  relationshipId?: string | null;
  characterId?: string | null;
  chapterNumber: number;
  cause: string;
}): string {
  const subject = event.relationshipId ?? event.characterId ?? "?";
  return `${subject}:${event.chapterNumber}:${normalizeText(event.cause)}`;
}

export function existingEventKeys(events: StoryEvent[]): Set<string> {
  return new Set(events.map(eventKey));
}

/** Every event in a novel, for the callers that fold state over all of them. */
export async function loadStoryEvents(novelId: string): Promise<StoryEvent[]> {
  const db = getDb();
  return db.select().from(storyEvents).where(eq(storyEvents.novelId, novelId));
}
