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
    beatId,
  } = parsed.data;

  const { chapter, context } = await buildSceneContext({
    novelId,
    chapterId,
    selectedCharacterIds,
    selectedLocationIds,
    selectedElementIds,
    instruction,
    draftTail: existingContent,
  });
  if (!chapter) {
    return Response.json({ error: "Chapter not found" }, { status: 404 });
  }

  const beat = beatId ? chapter.beats.find((b) => b.id === beatId) : undefined;
  const draft = existingContent.trim();

  let task: string;
  if (beat) {
    task = draft
      ? `Write the next passage of Chapter ${chapter.number} ("${chapter.title}"), covering exactly this beat and no further:\n\n> ${beat.text}\n\nContinue seamlessly from where the draft below stops. Do not repeat or rewrite what is already there — output only the new passage.\n\n## Draft so far\n${draft}`
      : `Open Chapter ${chapter.number} ("${chapter.title}") by writing exactly this beat and no further:\n\n> ${beat.text}`;
  } else if (draft) {
    task = `Continue Chapter ${chapter.number} ("${chapter.title}") from where the draft below stops. Write the next passage seamlessly — do not repeat or rewrite what is already there, output only the continuation.\n\n## Draft so far\n${draft}`;
  } else {
    task = `Write Chapter ${chapter.number} ("${chapter.title}") of this novel. Produce polished narrative prose with dialogue where natural. Aim for a satisfying scene structure with a hook at the end.`;
  }

  const started = Date.now();
  const result = streamText({
    model: MODELS.writing,
    instructions:
      NOVELIST_PERSONA +
      ` Obey the style contract exactly. Output only the chapter prose itself — no headings, no meta commentary, no author notes. Use Markdown only for emphasis and scene breaks (---); never wrap the prose in code fences.`,
    prompt: `${context.text}\n\n---\n${task}${instruction ? `\n\nAuthor's direction for this passage: ${instruction}` : ""}`,
  });

  return proseStreamResponse(result.fullStream, {
    onFinish: (usage) =>
      logGeneration({
        novelId,
        chapterId,
        route: beat ? "chapter:beat" : "chapter",
        model: MODELS.writing,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - started,
      }),
  });
}
