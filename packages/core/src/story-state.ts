/**
 * Derives "what was true in chapter N" from the event log.
 *
 * Nothing in this file queries the database. Every read path already loads its
 * events in one bulk select, so state is folded in memory — which is what lets
 * the canvas scrub across chapters without a round trip per frame.
 */
import type {
  CharStatus,
  Character,
  EventImpact,
  Relationship,
  RelType,
  StoryEvent,
} from "@behindthestory/db/schema";

/** Read the newest state, ignoring where the author currently is in the novel. */
export const LATEST = Number.POSITIVE_INFINITY;

/** A character with no status event has been alive since the novel opened. */
export const DEFAULT_STATUS: CharStatus = "alive";

export type RelationshipState = {
  type: RelType;
  closeness: number;
  /** The chapter this state began. 0 means "since before the novel opened". */
  sinceChapter: number;
  /** The event that established it, for citation and for the "why" panel. */
  event: StoryEvent;
};

export type CharacterState = {
  status: CharStatus;
  sinceChapter: number;
  /** Null when the character simply has no status event — alive by default. */
  event: StoryEvent | null;
};

// ---------------------------------------------------------------------------
// Ordering and grouping
// ---------------------------------------------------------------------------

/**
 * Chapter order first, then insertion order. The `createdAt` tiebreak matters:
 * two events on the same chapter must resolve deterministically, otherwise the
 * derived state flickers between reads.
 */
export function compareEvents(a: StoryEvent, b: StoryEvent): number {
  return (
    a.chapterNumber - b.chapterNumber ||
    a.createdAt.valueOf() - b.createdAt.valueOf() ||
    a.id.localeCompare(b.id)
  );
}

export function sortEvents(events: StoryEvent[]): StoryEvent[] {
  return [...events].sort(compareEvents);
}

/** Sorted events keyed by relationship id. Character events are excluded. */
export function eventsByRelationship(
  events: StoryEvent[],
): Map<string, StoryEvent[]> {
  return groupBy(events, (e) => e.relationshipId);
}

/** Sorted events keyed by character id. Relationship events are excluded. */
export function eventsByCharacter(
  events: StoryEvent[],
): Map<string, StoryEvent[]> {
  return groupBy(events, (e) => e.characterId);
}

function groupBy(
  events: StoryEvent[],
  key: (e: StoryEvent) => string | null,
): Map<string, StoryEvent[]> {
  const out = new Map<string, StoryEvent[]>();
  for (const event of events) {
    const id = key(event);
    if (!id) continue;
    const list = out.get(id);
    if (list) list.push(event);
    else out.set(id, [event]);
  }
  for (const list of out.values()) list.sort(compareEvents);
  return out;
}

// ---------------------------------------------------------------------------
// State as of a chapter
// ---------------------------------------------------------------------------

/** The last event at or before `asOf`. Assumes `events` is sorted. */
function lastAtOrBefore(
  events: StoryEvent[],
  asOf: number,
): StoryEvent | null {
  let found: StoryEvent | null = null;
  for (const event of events) {
    if (event.chapterNumber > asOf) break;
    found = event;
  }
  return found;
}

/**
 * What this bond was in chapter `asOf`.
 *
 * Null means the bond had not formed yet — a pair whose first event is in
 * chapter 40 has no state in chapter 11, and callers are expected to render
 * nothing rather than fall back to a default. That absence is information.
 */
export function relationshipStateAsOf(
  events: StoryEvent[],
  asOf: number = LATEST,
): RelationshipState | null {
  const event = lastAtOrBefore(events, asOf);
  // The check constraint guarantees both fields on a relationship event; the
  // guard is here to keep this total rather than to cover a reachable case.
  if (!event || event.relType === null || event.closeness === null) return null;
  return {
    type: event.relType,
    closeness: event.closeness,
    sinceChapter: event.chapterNumber,
    event,
  };
}

export function characterStateAsOf(
  events: StoryEvent[],
  asOf: number = LATEST,
): CharacterState {
  const event = lastAtOrBefore(events, asOf);
  if (!event || event.charStatus === null) {
    return { status: DEFAULT_STATUS, sinceChapter: 0, event: null };
  }
  return {
    status: event.charStatus,
    sinceChapter: event.chapterNumber,
    event,
  };
}

// ---------------------------------------------------------------------------
// Causality
// ---------------------------------------------------------------------------

/** One step in the answer to "why are they like this now?". */
export type TraceStep = {
  event: StoryEvent;
  /** The state this event moved away from, or null for the opening state. */
  from: { type: RelType; closeness: number } | null;
  to: { type: RelType; closeness: number };
  /** True when the bond's kind changed here, not just its intensity. */
  isTurn: boolean;
};

const IMPACT_WEIGHT: Record<EventImpact, number> = {
  pivotal: 0,
  major: 1,
  minor: 2,
};

/**
 * The causal chain behind a bond's current state, newest last.
 *
 * At 600 chapters a pair can have dozens of events and dumping them all is
 * useless to a reader and unaffordable in a prompt. So the chain keeps what
 * actually explains the present: every event where the bond's *kind* turned,
 * every `pivotal` event, and the opening state that started it all. Intensity
 * drift is dropped — it is visible in the full timeline when wanted.
 *
 * `limit` trims from the middle rather than the end, because the opening and
 * the most recent turns are the two things that carry the explanation.
 */
export function causalTrace(
  events: StoryEvent[],
  asOf: number = LATEST,
  limit = Number.POSITIVE_INFINITY,
): TraceStep[] {
  const steps = allTransitions(events, asOf);
  const kept = steps.filter(
    (s, i) => i === 0 || s.isTurn || s.event.impact === "pivotal",
  );
  if (kept.length <= limit) return kept;
  // Keep the opening, then the most significant recent turns, then restore
  // chronological order — a trace read out of order explains nothing.
  const [opening, ...rest] = kept;
  const room = Math.max(0, limit - 1);
  const trimmed = [...rest]
    .sort(
      (a, b) =>
        IMPACT_WEIGHT[a.event.impact] - IMPACT_WEIGHT[b.event.impact] ||
        b.event.chapterNumber - a.event.chapterNumber,
    )
    .slice(0, room)
    .sort((a, b) => compareEvents(a.event, b.event));
  return [opening, ...trimmed];
}

/** Every relationship event up to `asOf`, paired with the state it moved from. */
export function allTransitions(
  events: StoryEvent[],
  asOf: number = LATEST,
): TraceStep[] {
  const steps: TraceStep[] = [];
  let prev: { type: RelType; closeness: number } | null = null;
  for (const event of events) {
    if (event.chapterNumber > asOf) break;
    if (event.relType === null || event.closeness === null) continue;
    const to = { type: event.relType, closeness: event.closeness };
    steps.push({
      event,
      from: prev,
      to,
      isTurn: prev !== null && prev.type !== to.type,
    });
    prev = to;
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Formatting — shared by the UI and the prompt so they never disagree
// ---------------------------------------------------------------------------

export function formatChapterRef(chapterNumber: number): string {
  return chapterNumber === 0 ? "before Ch. 1" : `Ch. ${chapterNumber}`;
}

/** "enemy → friendship, closeness 2→8" / "friendship, closeness 6→8". */
export function describeTransition(step: TraceStep): string {
  const kind = step.from
    ? step.isTurn
      ? `${step.from.type} → ${step.to.type}`
      : step.to.type
    : step.to.type;
  const closeness =
    step.from && step.from.closeness !== step.to.closeness
      ? `closeness ${step.from.closeness}→${step.to.closeness}`
      : `closeness ${step.to.closeness}/10`;
  return `${kind}, ${closeness}`;
}

/**
 * A one-line causal chain: "Ch. 128 enemy, closeness 2/10: … → Ch. 341 …".
 *
 * `nameOf` is supplied by the caller because only it holds the roster; without
 * it the drivers are omitted rather than printed as raw ids.
 */
export function formatTrace(
  steps: TraceStep[],
  nameOf?: (characterId: string) => string,
): string {
  return steps
    .map((s) => {
      const drivers = nameOf
        ? s.event.driverCharacterIds.map(nameOf).filter(Boolean)
        : [];
      const by = drivers.length ? ` [${drivers.join(", ")}]` : "";
      const cause = s.event.cause ? `: ${s.event.cause}` : "";
      return `${formatChapterRef(s.event.chapterNumber)} ${describeTransition(s)}${cause}${by}`;
    })
    .join(" → ");
}

// ---------------------------------------------------------------------------
// Convenience for callers holding whole collections
// ---------------------------------------------------------------------------

export type DerivedRelationship = {
  relationship: Relationship;
  state: RelationshipState;
};

/**
 * Every bond that exists as of `asOf`, with its state. Bonds not yet formed are
 * omitted entirely rather than defaulted.
 */
export function relationshipsAsOf(
  rels: Relationship[],
  events: StoryEvent[],
  asOf: number = LATEST,
): DerivedRelationship[] {
  const byRel = eventsByRelationship(events);
  const out: DerivedRelationship[] = [];
  for (const relationship of rels) {
    const state = relationshipStateAsOf(byRel.get(relationship.id) ?? [], asOf);
    if (state) out.push({ relationship, state });
  }
  return out;
}

export function charactersAsOf(
  chars: Character[],
  events: StoryEvent[],
  asOf: number = LATEST,
): Map<string, CharacterState> {
  const byChar = eventsByCharacter(events);
  const out = new Map<string, CharacterState>();
  for (const character of chars) {
    out.set(
      character.id,
      characterStateAsOf(byChar.get(character.id) ?? [], asOf),
    );
  }
  return out;
}
