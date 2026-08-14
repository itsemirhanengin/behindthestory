import { eq } from "drizzle-orm";
import {
  getDb,
  novels,
  characters,
  characterFacts,
  relationships,
  storyEvents,
  locations,
  chapters,
  storyElements,
  type Character,
  type CharacterFact,
  type Relationship,
  type StoryEvent,
  type Location,
  type Chapter,
  type StoryElement,
  type Novel,
} from "@behindthestory/db";
import { compileStyleDirective } from "@behindthestory/ai";
import {
  LATEST,
  causalTrace,
  characterStateAsOf,
  eventsByCharacter,
  eventsByRelationship,
  formatChapterRef,
  formatTrace,
  relationshipStateAsOf,
  type RelationshipState,
} from "./story-state";

export type NovelBundle = {
  novel: Novel;
  characters: Character[];
  characterFacts: CharacterFact[];
  relationships: Relationship[];
  storyEvents: StoryEvent[];
  locations: Location[];
  chapters: Chapter[];
  storyElements: StoryElement[];
};

/**
 * The chapters that actually make up the novel: one active variant per slot,
 * in reading order. Inactive variants are alternative takes and must never
 * leak into context, the reading view or an export.
 */
export function activeSpine(chapters: Chapter[]): Chapter[] {
  return chapters
    .filter((ch) => ch.isActive)
    .sort((a, b) => a.number - b.number);
}

export async function loadNovelBundle(novelId: string): Promise<NovelBundle> {
  const db = getDb();
  const [novel] = await db.select().from(novels).where(eq(novels.id, novelId));
  if (!novel) throw new Error("Novel not found");
  const [chars, facts, rels, events, locs, chaps, elements] = await Promise.all([
    db.select().from(characters).where(eq(characters.novelId, novelId)),
    db.select().from(characterFacts).where(eq(characterFacts.novelId, novelId)),
    db.select().from(relationships).where(eq(relationships.novelId, novelId)),
    db.select().from(storyEvents).where(eq(storyEvents.novelId, novelId)),
    db.select().from(locations).where(eq(locations.novelId, novelId)),
    db.select().from(chapters).where(eq(chapters.novelId, novelId)),
    db.select().from(storyElements).where(eq(storyElements.novelId, novelId)),
  ]);
  chaps.sort(
    (a, b) => a.number - b.number || a.variantLabel.localeCompare(b.variantLabel),
  );
  return {
    novel,
    characters: chars,
    characterFacts: facts,
    relationships: rels,
    storyEvents: events,
    locations: locs,
    chapters: chaps,
    storyElements: elements,
  };
}

// ---------------------------------------------------------------------------
// Budgeting
// ---------------------------------------------------------------------------

/**
 * Deliberately conservative: English prose runs ~4 chars/token, and
 * underestimating the budget is far worse than leaving headroom.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export const DEFAULT_CONTEXT_BUDGET = Number(
  process.env.AI_CONTEXT_BUDGET ?? 40_000,
);

/**
 * Per-section ceilings as a fraction of the total budget. They stop any single
 * section — usually the parent chapter's tail — from crowding out the rest.
 * They intentionally sum above 1: the global budget is the real constraint,
 * and sections are filled in the order listed below.
 */
const SECTION_CAPS = {
  identity: 1,
  beats: 0.08,
  parentTail: 0.18,
  cast: 0.24,
  relationships: 0.1,
  locations: 0.08,
  elements: 0.12,
  retrieved: 0.18,
  history: 0.14,
} as const;

type SectionKey = keyof typeof SECTION_CAPS;

/** Report of what actually made it into the prompt, surfaced in the UI. */
export type ContextSection = {
  key: SectionKey;
  title: string;
  tokens: number;
  included: number;
  omitted: number;
};

export type BuiltContext = {
  text: string;
  tokenEstimate: number;
  budget: number;
  sections: ContextSection[];
};

/** A passage retrieved from earlier chapters by semantic similarity. */
export type RetrievedPassage = {
  chapterNumber: number;
  chapterTitle: string;
  content: string;
  similarity: number;
};

/**
 * One renderable item. `rank` decides what survives a tight budget (lower wins)
 * and `order` decides how the survivors are laid out.
 */
type Entry = { text: string; rank: number; order: number };

type PackedSection = {
  body: string;
  tokens: number;
  included: number;
  omitted: number;
};

function packEntries(entries: Entry[], capTokens: number): PackedSection {
  const byRank = [...entries].sort((a, b) => a.rank - b.rank || a.order - b.order);
  const taken: Entry[] = [];
  let tokens = 0;
  for (const entry of byRank) {
    const cost = estimateTokens(entry.text) + 1; // +1 for the joining newline
    if (tokens + cost > capTokens) continue;
    taken.push(entry);
    tokens += cost;
  }
  const body = taken
    .sort((a, b) => a.order - b.order)
    .map((e) => e.text)
    .join("\n");
  return {
    body,
    tokens,
    included: taken.length,
    omitted: entries.length - taken.length,
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function characterBlock(
  c: Character,
  full: boolean,
  facts: CharacterFact[],
  status: string,
): string {
  const head = `- ${c.name} (${c.role}, ${status})${c.summary ? `: ${c.summary}` : ""}`;
  if (!full) return head;
  const lines = [head];
  if (c.traits.length) lines.push(`  Traits: ${c.traits.join(", ")}`);
  if (c.appearance) lines.push(`  Appearance: ${c.appearance}`);
  if (c.motivation) lines.push(`  Wants: ${c.motivation}`);
  if (c.arc) lines.push(`  Arc: ${c.arc}`);
  if (c.voice) lines.push(`  Voice: ${c.voice}`);
  if (c.speechSample) {
    lines.push(`  Speaks like: ${c.speechSample.replace(/\s*\n\s*/g, " / ")}`);
  }
  if (c.backstory) lines.push(`  Backstory: ${c.backstory}`);
  if (c.secrets) lines.push(`  Secrets (known to author only): ${c.secrets}`);
  if (facts.length) {
    lines.push(
      `  Established in earlier chapters:\n${facts
        .map((f) => `    · ${f.fact}`)
        .join("\n")}`,
    );
  }
  return lines.join("\n");
}

/** How many causal steps a bond gets in the prompt. See `causalTrace`. */
const TRACE_STEPS_IN_PROMPT = 4;

/**
 * A bond as it stands at the chapter being written, plus why it stands that way.
 *
 * The trace is what makes this worth more than a type and a number: a model
 * writing chapter 685 needs to know not just that the pair are allies but that
 * they got there from a blood feud, and what turned it.
 */
function relationshipBlock(
  r: Relationship,
  state: RelationshipState,
  events: StoryEvent[],
  asOf: number,
  byId: Map<string, Character>,
) {
  const nameOf = (id: string) => byId.get(id)?.name ?? "";
  const a = nameOf(r.sourceCharacterId) || "?";
  const b = nameOf(r.targetCharacterId) || "?";
  const since =
    state.sinceChapter > 0 ? ` (since ${formatChapterRef(state.sinceChapter)})` : "";
  const head = `- ${a} ↔ ${b}: ${state.type}, closeness ${state.closeness}/10${since}${
    r.description ? `. ${r.description}` : ""
  }`;
  // A bond with a single event has no history to explain — the head says it all.
  const trace = causalTrace(events, asOf, TRACE_STEPS_IN_PROMPT);
  if (trace.length < 2) return head;
  return `${head}\n  How they got here: ${formatTrace(trace, nameOf)}`;
}

function locationBlock(l: Location, full: boolean) {
  const head = `- ${l.name}${l.atmosphere ? ` (${l.atmosphere})` : ""}`;
  if (!full) return head;
  const lines = [head + (l.description ? `: ${l.description}` : "")];
  if (l.significance) lines.push(`  Significance: ${l.significance}`);
  return lines.join("\n");
}

function elementBlock(e: StoryElement) {
  return `- [${e.type}, ${e.status}] ${e.title}: ${e.description}`;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export type ContextOptions = {
  selectedCharacterIds?: string[];
  selectedLocationIds?: string[];
  selectedElementIds?: string[];
  /** Chapter being written. Drives beats, history exclusion and the parent tail. */
  currentChapter?: Chapter;
  /** Semantically retrieved prose from earlier chapters. */
  retrieved?: RetrievedPassage[];
  budgetTokens?: number;
};

/**
 * Assembles the story context under a hard token budget.
 *
 * Selection promotes an entity to full detail and to the front of the queue;
 * it never hard-excludes the rest. What gets dropped is decided by the budget,
 * and every drop is reported back so the author can see it.
 */
export function buildStoryContext(
  bundle: NovelBundle,
  opts: ContextOptions = {},
): BuiltContext {
  const budget = opts.budgetTokens ?? DEFAULT_CONTEXT_BUDGET;
  const { novel } = bundle;
  const byId = new Map(bundle.characters.map((c) => [c.id, c]));
  const selChars = new Set(opts.selectedCharacterIds ?? []);
  const selLocs = new Set(opts.selectedLocationIds ?? []);
  const selElems = new Set(opts.selectedElementIds ?? []);

  // Everything below is rendered as the story stood *before* the chapter being
  // written. Without this the model is handed its own future: the state a bond
  // only reaches in chapter 600, and facts not yet revealed. When no chapter is
  // in play (a whole-novel view) the latest state is correct.
  const asOf = opts.currentChapter ? opts.currentChapter.number - 1 : LATEST;
  const relEventsById = eventsByRelationship(bundle.storyEvents);
  const charEventsById = eventsByCharacter(bundle.storyEvents);
  const statusOf = (id: string) =>
    characterStateAsOf(charEventsById.get(id) ?? [], asOf).status;

  // Facts are cited to a chapter, so they can be held back the same way. A fact
  // with no citation survived its chapter being deleted — it stays, because
  // dropping established canon is worse than citing it vaguely.
  const chapterNumberById = new Map(
    bundle.chapters.map((ch) => [ch.id, ch.number]),
  );
  const factsByCharacter = new Map<string, CharacterFact[]>();
  for (const fact of bundle.characterFacts) {
    const revealedIn = fact.chapterId
      ? chapterNumberById.get(fact.chapterId)
      : undefined;
    if (revealedIn !== undefined && revealedIn > asOf) continue;
    const list = factsByCharacter.get(fact.characterId) ?? [];
    list.push(fact);
    factsByCharacter.set(fact.characterId, list);
  }

  const parts: string[] = [];
  const sections: ContextSection[] = [];
  let spent = 0;

  const emit = (
    key: SectionKey,
    title: string,
    heading: string | null,
    entries: Entry[],
  ) => {
    if (entries.length === 0) return;
    const cap = Math.floor(budget * SECTION_CAPS[key]);
    const remaining = budget - spent;
    const packed = packEntries(entries, Math.max(0, Math.min(cap, remaining)));
    if (packed.included === 0) {
      sections.push({ key, title, tokens: 0, included: 0, omitted: entries.length });
      return;
    }
    const note =
      packed.omitted > 0
        ? `\n(${packed.omitted} more omitted to stay within the context budget)`
        : "";
    const block = heading
      ? `\n## ${heading}\n${packed.body}${note}`
      : `${packed.body}${note}`;
    parts.push(block);
    spent += estimateTokens(block);
    sections.push({
      key,
      title,
      tokens: packed.tokens,
      included: packed.included,
      omitted: packed.omitted,
    });
  };

  // 1. Identity + style contract. Always present; it is small and binding.
  const identity = [
    `# Novel: ${novel.title}`,
    novel.premise ? `Premise: ${novel.premise}` : "",
    compileStyleDirective(novel),
  ]
    .filter(Boolean)
    .join("\n");
  parts.push(identity);
  spent += estimateTokens(identity);
  sections.push({
    key: "identity",
    title: "Novel & style",
    tokens: estimateTokens(identity),
    included: 1,
    omitted: 0,
  });

  // 2. The plan for the chapter being written.
  const current = opts.currentChapter;
  if (current && (current.outline || current.beats.length)) {
    const entries: Entry[] = [];
    if (current.outline) {
      entries.push({ text: current.outline, rank: 0, order: 0 });
    }
    current.beats.forEach((beat, i) => {
      entries.push({
        text: `- [${beat.done ? "written" : "to write"}] ${beat.text}`,
        rank: 1,
        order: i + 1,
      });
    });
    emit("beats", "Chapter plan", `Plan for this chapter`, entries);
  }

  // 3. Where the prose must pick up from: the active chapter one slot back,
  // unless this chapter deliberately starts fresh (time jump, POV switch).
  const spine = activeSpine(bundle.chapters);
  if (current?.continuesFromPrevious) {
    const parent = spine.find((ch) => ch.number === current.number - 1);
    if (parent?.content) {
      const cap = Math.floor(budget * SECTION_CAPS.parentTail);
      // Trim from the front so the passage always ends where writing resumes.
      const tail = parent.content.slice(-Math.floor(cap * 3.6));
      const truncated = tail.length < parent.content.length;
      const text = `${truncated ? "..." : ""}${tail}`;
      emit(
        "parentTail",
        "End of previous chapter",
        `End of the previous chapter (Chapter ${parent.number} "${parent.title}") — continue from here`,
        [{ text, rank: 0, order: 0 }],
      );
    }
  }

  // 4. Cast. Selected characters in full, then leads, then the long tail brief.
  const roleRank: Record<Character["role"], number> = {
    main: 1,
    side: 2,
    minor: 3,
  };
  const castEntries: Entry[] = bundle.characters.map((c, i) => {
    const selected = selChars.has(c.id);
    return {
      text: characterBlock(
        c,
        selected,
        factsByCharacter.get(c.id) ?? [],
        statusOf(c.id),
      ),
      rank: selected ? 0 : roleRank[c.role],
      order: i,
    };
  });
  emit("cast", "Characters", "Characters", castEntries);

  // 5. Relationships, closest bonds and those touching the scene's cast first.
  // A bond whose first event is still ahead of this chapter has not formed yet
  // and is omitted — the pair genuinely have no relationship at this point.
  const relEntries: Entry[] = bundle.relationships.flatMap((r, i) => {
    const events = relEventsById.get(r.id) ?? [];
    const state = relationshipStateAsOf(events, asOf);
    if (!state) return [];
    const touchesSelection =
      selChars.has(r.sourceCharacterId) || selChars.has(r.targetCharacterId);
    return [
      {
        text: relationshipBlock(r, state, events, asOf, byId),
        // Closer bonds outrank distant ones within the same tier.
        rank: (touchesSelection ? 0 : 10) + (10 - state.closeness) / 10,
        order: i,
      },
    ];
  });
  emit("relationships", "Relationships", "Relationships", relEntries);

  // 6. Locations. Selected ones in full; the rest as name-only orientation.
  const locEntries: Entry[] = bundle.locations.map((l, i) => ({
    text: locationBlock(l, selLocs.has(l.id)),
    rank: selLocs.has(l.id) ? 0 : 1,
    order: i,
  }));
  emit("locations", "Locations", "Locations", locEntries);

  // 7. Open story threads. Resolved ones only appear if explicitly selected.
  const statusRank: Record<StoryElement["status"], number> = {
    developing: 1,
    planted: 2,
    resolved: 9,
  };
  const elemEntries: Entry[] = bundle.storyElements
    .filter((e) => e.status !== "resolved" || selElems.has(e.id))
    .map((e, i) => ({
      text: elementBlock(e),
      rank: selElems.has(e.id) ? 0 : statusRank[e.status],
      order: i,
    }));
  emit(
    "elements",
    "Story memory",
    "Story memory (twists, foreshadowing, plot threads)",
    elemEntries,
  );

  // 8. Retrieved prose. This is what keeps a 40-chapter novel coherent.
  const retrieved = opts.retrieved ?? [];
  const retrievedEntries: Entry[] = retrieved.map((p, i) => ({
    text: `### From Chapter ${p.chapterNumber} "${p.chapterTitle}"\n${p.content}`,
    rank: i, // already ordered by similarity
    order: i,
  }));
  emit(
    "retrieved",
    "Relevant earlier passages",
    "Relevant passages from earlier chapters",
    retrievedEntries,
  );

  // 9. Chapter summaries. Recent history outranks distant history, but the
  // opening chapter is kept near the front because it anchors the premise.
  // Sibling variants of the chapter being written are alternative takes of the
  // same slot, so they are excluded alongside the chapter itself — and so is
  // everything after it, which the model must not be able to read.
  const prior = current
    ? spine.filter((ch) => ch.number < current.number)
    : spine;
  const lastNumber = prior.length ? prior[prior.length - 1].number : 0;
  const historyEntries: Entry[] = prior.map((ch, i) => ({
    text: `- Chapter ${ch.number} "${ch.title}": ${ch.summary || "(no summary yet — this chapter has not been analyzed)"}`,
    rank: i === 0 ? 0.5 : lastNumber - ch.number + 1,
    order: i,
  }));
  emit("history", "Previous chapters", "Previous chapters", historyEntries);

  const text = parts.join("\n");
  return {
    text,
    tokenEstimate: estimateTokens(text),
    budget,
    sections,
  };
}
