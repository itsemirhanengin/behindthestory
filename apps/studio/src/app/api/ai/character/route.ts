import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@behindthestory/ai";
import { loadNovelBundle, buildStoryContext } from "@behindthestory/core/context-builder";

export const maxDuration = 300;

const characterSchema = z.object({
  name: z.string(),
  role: z.enum(["main", "side", "minor"]),
  summary: z.string().describe("One or two sentences capturing the character"),
  backstory: z.string().describe("2-4 paragraphs of backstory"),
  traits: z.array(z.string()).describe("3-6 personality traits"),
  appearance: z.string(),
  secrets: z
    .string()
    .describe("Hidden motives or secrets, usable for future twists"),
  voice: z
    .string()
    .describe(
      "How this character speaks: diction, rhythm, verbal tics, what they never say",
    ),
  speechSample: z
    .string()
    .describe(
      "Two or three example lines of their dialogue, one per line, no quotation marks",
    ),
  motivation: z.string().describe("What they want right now, in one sentence"),
  arc: z.string().describe("Where they are headed across the novel"),
});

const bodySchema = z.object({
  novelId: z.uuid(),
  characterId: z.uuid().optional(),
  hint: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { novelId, characterId, hint } = parsed.data;

  const bundle = await loadNovelBundle(novelId);
  const context = buildStoryContext(bundle);

  const existing = characterId
    ? bundle.characters.find((c) => c.id === characterId)
    : undefined;

  const task = existing
    ? `Enrich the existing character "${existing.name}". Keep every already-filled field consistent (you may polish wording, never contradict). Fill in the empty fields with compelling material that fits the story. Current data: ${JSON.stringify(
        {
          name: existing.name,
          role: existing.role,
          summary: existing.summary,
          backstory: existing.backstory,
          traits: existing.traits,
          appearance: existing.appearance,
          secrets: existing.secrets,
          voice: existing.voice,
          speechSample: existing.speechSample,
          motivation: existing.motivation,
          arc: existing.arc,
        },
      )}`
    : `Invent a brand-new character that would enrich this story. They must not duplicate an existing character.`;

  const started = Date.now();
  const { output, usage } = await generateText({
    model: MODELS.writing,
    instructions:
      NOVELIST_PERSONA +
      ` The voice and speechSample fields matter most: they are what stops every character in this novel sounding like the same narrator. Make them specific and distinguishable from the existing cast.`,
    output: Output.object({ schema: characterSchema }),
    prompt: `${context.text}\n\n---\nTask: ${task}${hint ? `\nAuthor's direction: ${hint}` : ""}`,
  });

  await logGeneration({
    novelId,
    route: "character",
    model: MODELS.writing,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    durationMs: Date.now() - started,
  });

  return NextResponse.json(output);
}
