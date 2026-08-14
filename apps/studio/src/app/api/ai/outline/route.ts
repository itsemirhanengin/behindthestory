import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@behindthestory/ai";
import { buildSceneContext } from "@behindthestory/core/scene-context";

export const maxDuration = 300;

const outlineSchema = z.object({
  title: z
    .string()
    .describe("A chapter title that does not give away the ending"),
  outline: z
    .string()
    .describe(
      "Two or three sentences: what this chapter is for in the novel, and how it moves the story",
    ),
  beats: z
    .array(z.string())
    .describe(
      "4-8 beats, each one sentence describing a concrete unit of action, in order. Not summary — what actually happens on the page.",
    ),
});

const bodySchema = z.object({
  novelId: z.uuid(),
  chapterId: z.uuid(),
  instruction: z.string().max(4000).optional(),
  selectedCharacterIds: z.array(z.uuid()).default([]),
  selectedLocationIds: z.array(z.uuid()).default([]),
  selectedElementIds: z.array(z.uuid()).default([]),
});

/**
 * Plans a chapter before a word of it is written. Turns one unguided
 * generation into plan → write, which the author can steer at the plan stage.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { novelId, chapterId, instruction, ...selections } = parsed.data;

  const { chapter, context } = await buildSceneContext({
    novelId,
    chapterId,
    instruction,
    ...selections,
  });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  const started = Date.now();
  const { output, usage } = await generateText({
    model: MODELS.writing,
    instructions:
      NOVELIST_PERSONA +
      ` You are planning a chapter, not writing it. Beats must be concrete and dramatic — a thing that happens, not a theme. Advance at least one open thread from the story memory, and set up or pay off something. Respect the target chapter length when deciding how many beats fit.`,
    output: Output.object({ schema: outlineSchema }),
    prompt: `${context.text}

---
Task: Plan Chapter ${chapter.number}${chapter.title && chapter.title !== `Chapter ${chapter.number}` ? ` ("${chapter.title}")` : ""}.${instruction ? `\n\nAuthor's direction: ${instruction}` : ""}`,
  });

  await logGeneration({
    novelId,
    chapterId,
    route: "outline",
    model: MODELS.writing,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    durationMs: Date.now() - started,
  });

  return NextResponse.json(output);
}
