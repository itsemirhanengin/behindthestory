import { streamText } from "ai";
import { z } from "zod";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@/lib/ai";
import { buildSceneContext } from "@/lib/scene-context";
import { proseStreamResponse } from "@/lib/prose-stream";

export const maxDuration = 300;

const bodySchema = z.object({
  novelId: z.uuid(),
  chapterId: z.uuid(),
  instruction: z.string().max(4000).optional(),
  selectedCharacterIds: z.array(z.uuid()).default([]),
  selectedLocationIds: z.array(z.uuid()).default([]),
  selectedElementIds: z.array(z.uuid()).default([]),
  existingContent: z.string().default(""),
  placement: z.enum(["cursor", "end"]).default("end"),
  before: z.string().max(5000).default(""),
  after: z.string().max(5000).default(""),
  /** When set, the model writes only this beat rather than the whole chapter. */
  beatId: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: `Invalid request: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    );
  }
  const {
    novelId,
    chapterId,
    instruction,
    selectedCharacterIds,
    selectedLocationIds,
    selectedElementIds,
    existingContent,
    placement,
    before,
    after,
    beatId,
  } = parsed.data;

  const started = Date.now();
  let generationRoute = "chapter";

  return proseStreamResponse(async ({ status }) => {
    status("context", "Building story context");
    const { chapter, context, retrievedCount } = await buildSceneContext({
      novelId,
      chapterId,
      selectedCharacterIds,
      selectedLocationIds,
      selectedElementIds,
      instruction,
      draftTail: placement === "cursor" ? before : existingContent,
    });
    if (!chapter) throw new Error("Chapter not found");

    const beat = beatId
      ? chapter.beats.find((candidate) => candidate.id === beatId)
      : undefined;
    const draft = existingContent.trim();
    generationRoute = beat ? "chapter:beat" : "chapter";

    let task: string;
    if (placement === "cursor") {
      task = `Write a new passage at the marked insertion point inside Chapter ${chapter.number} ("${chapter.title}").${beat ? ` Cover exactly this beat and no further:\n\n> ${beat.text}\n` : ""}

### Immediately before the insertion point
${before || "(this is the start of the chapter)"}

### Immediately after the insertion point
${after || "(this is the end of the chapter)"}

Join seamlessly at both edges. Do not repeat either surrounding passage. Output only the new prose.`;
    } else if (beat) {
      task = draft
        ? `Write the next passage of Chapter ${chapter.number} ("${chapter.title}"), covering exactly this beat and no further:\n\n> ${beat.text}\n\nContinue seamlessly from where the draft below stops. Do not repeat or rewrite what is already there — output only the new passage.\n\n## Draft so far\n${draft}`
        : `Open Chapter ${chapter.number} ("${chapter.title}") by writing exactly this beat and no further:\n\n> ${beat.text}`;
    } else if (draft) {
      task = `Continue Chapter ${chapter.number} ("${chapter.title}") from where the draft below stops. Write the next passage seamlessly — do not repeat or rewrite what is already there, output only the continuation.\n\n## Draft so far\n${draft}`;
    } else {
      task = `Write the opening passage of Chapter ${chapter.number} ("${chapter.title}"). Produce polished narrative prose with dialogue where natural. Establish the scene and stop at a natural handoff point.`;
    }

    status(
      "model",
      retrievedCount
        ? `Context ready · ${retrievedCount} earlier passage${retrievedCount === 1 ? "" : "s"} retrieved`
        : "Context ready",
    );
    const result = streamText({
      model: MODELS.writing,
      abortSignal: req.signal,
      instructions:
        NOVELIST_PERSONA +
        ` Obey the style contract exactly. Output only the chapter prose itself — no headings, no meta commentary, no author notes. Use Markdown only for emphasis and scene breaks (---); never wrap the prose in code fences.`,
      prompt: `${context.text}\n\n---\n${task}${instruction ? `\n\nAuthor's direction for this passage: ${instruction}` : ""}`,
    });
    return result.fullStream;
  }, {
    onFinish: (usage) =>
      logGeneration({
        novelId,
        chapterId,
        route: generationRoute,
        model: MODELS.writing,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - started,
      }),
  });
}
