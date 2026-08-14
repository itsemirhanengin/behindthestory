import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  REL_TYPE_VALUES,
  CHAR_STATUS_VALUES,
  EVENT_IMPACT_VALUES,
} from "@/db";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@/lib/ai";
import { loadNovelBundle, buildStoryContext } from "@/lib/context-builder";
import {
  eventsByRelationship,
  relationshipStateAsOf,
} from "@/lib/story-state";

export const maxDuration = 300;

const analysisSchema = z.object({
  chapterSummary: z
    .string()
    .describe("3-5 sentence summary of what happens in this chapter"),
  newElements: z.array(
    z.object({
      type: z.enum(["twist", "foreshadowing", "plot_thread", "event"]),
      title: z.string(),
      description: z.string(),
      relatedCharacterIds: z.array(z.string()),
    }),
  ),
  resolvedElementIds: z
    .array(z.string())
    .describe(
      "Ids of existing story elements that this chapter pays off / resolves",
    ),
  relationshipUpdates: z.array(
    z.object({
      relationshipId: z.string(),
      newType: z
        .enum(REL_TYPE_VALUES)
        .describe(
          "What the bond IS after this chapter. Repeat the current type if the kind of bond did not change",
        ),
      closeness: z
        .number()
        .describe("1-10, how close/intense the bond is AFTER this chapter"),
      cause: z
        .string()
        .describe(
          "What in THIS chapter changed the bond. Concrete and specific, e.g. 'Marit pulled Ione out of the well and named her brother's killer'",
        ),
      driverCharacterIds: z
        .array(z.string())
        .describe("Who caused the change. Empty if circumstance, not a person"),
      impact: z
        .enum(EVENT_IMPACT_VALUES)
        .describe(
          "pivotal = the bond turned or the story pivoted on it; major = a real shift; minor = small drift",
        ),
    }),
  ),
  /**
   * Death, disappearance and return. Split out from facts because it is a state
   * change with a cause, and the cause is the part an author comes back for.
   */
  characterStatusChanges: z.array(
    z.object({
      characterId: z.string(),
      newStatus: z.enum(CHAR_STATUS_VALUES),
      cause: z
        .string()
        .describe(
          "Why the status changed, with the agency made explicit — 'shielded Ione from the fall' is very different from 'fell because Ione misread the tide'",
        ),
      driverCharacterIds: z
        .array(z.string())
        .describe(
          "Who is responsible, including the character themselves if it was their own choice",
        ),
      impact: z.enum(EVENT_IMPACT_VALUES),
    }),
  ),
  newRelationships: z.array(
    z.object({
      sourceCharacterId: z.string(),
      targetCharacterId: z.string(),
      type: z.enum(REL_TYPE_VALUES),
      closeness: z.number(),
      description: z.string(),
      cause: z
        .string()
        .describe("What in this chapter established the bond"),
      impact: z.enum(EVENT_IMPACT_VALUES),
    }),
  ),
  characterFacts: z.array(
    z.object({
      characterId: z.string(),
      fact: z
        .string()
        .describe("New canon fact about this character revealed this chapter"),
    }),
  ),
});

export type ChapterAnalysis = z.infer<typeof analysisSchema>;

const bodySchema = z.object({ novelId: z.uuid(), chapterId: z.uuid() });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { novelId, chapterId } = parsed.data;
  const bundle = await loadNovelBundle(novelId);
  const chapter = bundle.chapters.find((ch) => ch.id === chapterId);
  if (!chapter || !chapter.content.trim()) {
    return NextResponse.json(
      { error: "chapter not found or empty" },
      { status: 400 },
    );
  }

  const context = buildStoryContext(bundle, { currentChapter: chapter });
  const roster = bundle.characters
    .map((c) => `${c.id} = ${c.name}`)
    .join("\n");
  // The state going *into* this chapter, so the model reports what the chapter
  // changed rather than restating what was already true.
  const asOf = chapter.number - 1;
  const relEventsById = eventsByRelationship(bundle.storyEvents);
  const relRoster = bundle.relationships
    .flatMap((r) => {
      const state = relationshipStateAsOf(relEventsById.get(r.id) ?? [], asOf);
      if (!state) return []; // not formed yet as of this chapter
      const a = bundle.characters.find((c) => c.id === r.sourceCharacterId);
      const b = bundle.characters.find((c) => c.id === r.targetCharacterId);
      return [
        `${r.id} = ${a?.name} ↔ ${b?.name} — entering this chapter: ${state.type}, closeness ${state.closeness}/10`,
      ];
    })
    .join("\n");
  const elementRoster = bundle.storyElements
    .filter((e) => e.status !== "resolved")
    .map((e) => `${e.id} = [${e.type}] ${e.title}`)
    .join("\n");

  const started = Date.now();
  const { output, usage } = await generateText({
    model: MODELS.utility,
    instructions:
      NOVELIST_PERSONA +
      ` You are acting as a meticulous story-bible keeper. Extract only what the chapter text actually establishes. Use ONLY the ids provided in the rosters; never invent ids. If nothing applies to a category, return an empty array for it.` +
      ` Relationship and status changes are recorded as a timeline the author will read hundreds of chapters later, so every one needs a CAUSE — what in this chapter did it — and, where a person is responsible, who. Report a change only if this chapter actually moved it; unchanged bonds belong in no array at all.`,
    output: Output.object({ schema: analysisSchema }),
    prompt: `${context.text}\n\n## Character ids\n${roster}\n\n## Relationship ids and their state entering this chapter\n${relRoster || "(none)"}\n\n## Open story element ids\n${elementRoster || "(none)"}\n\n---\n## Chapter ${chapter.number}: "${chapter.title}" — full text to analyze\n${chapter.content}\n\n---\nTask: Analyze this chapter and extract story-memory updates: a summary, new story elements (twists, planted foreshadowing, plot threads, notable events), which open elements it resolves, relationship changes (with their cause), character status changes such as a death or disappearance (with who is responsible and how), brand-new relationships, and new character facts.`,
  });

  await logGeneration({
    novelId,
    chapterId,
    route: "analyze",
    model: MODELS.utility,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    durationMs: Date.now() - started,
  });

  return NextResponse.json(output);
}
