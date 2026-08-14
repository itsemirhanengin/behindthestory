import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@/lib/ai";
import { loadNovelBundle, buildStoryContext } from "@/lib/context-builder";

export const maxDuration = 300;

const locationSchema = z.object({
  name: z.string(),
  description: z.string().describe("1-2 paragraphs describing the place"),
  atmosphere: z.string().describe("Mood and sensory feel, a short phrase"),
  significance: z.string().describe("Why this place matters to the story"),
});

const bodySchema = z.object({
  novelId: z.uuid(),
  locationId: z.uuid().optional(),
  hint: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { novelId, locationId, hint } = parsed.data;

  const bundle = await loadNovelBundle(novelId);
  const context = buildStoryContext(bundle);

  const existing = locationId
    ? bundle.locations.find((l) => l.id === locationId)
    : undefined;

  const task = existing
    ? `Enrich the existing location "${existing.name}". Never contradict filled fields; fill the empty ones. Current data: ${JSON.stringify(
        {
          name: existing.name,
          description: existing.description,
          atmosphere: existing.atmosphere,
          significance: existing.significance,
        },
      )}`
    : `Invent a new location that fits this story and would be a compelling setting for future scenes.`;

  const started = Date.now();
  const { output, usage } = await generateText({
    model: MODELS.writing,
    instructions: NOVELIST_PERSONA,
    output: Output.object({ schema: locationSchema }),
    prompt: `${context.text}\n\n---\nTask: ${task}${hint ? `\nAuthor's direction: ${hint}` : ""}`,
  });

  await logGeneration({
    novelId,
    route: "location",
    model: MODELS.writing,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    durationMs: Date.now() - started,
  });

  return NextResponse.json(output);
}
