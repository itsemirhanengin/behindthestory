import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, novels, POV_VALUES, TENSE_VALUES } from "@/db";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@/lib/ai";

export const maxDuration = 300;

const styleSchema = z.object({
  genre: z.string().describe("Genre and subgenre, e.g. 'literary thriller'"),
  tone: z
    .string()
    .describe("Three to five mood descriptors, comma separated"),
  pov: z.enum(POV_VALUES),
  tense: z.enum(TENSE_VALUES),
  targetChapterWords: z
    .number()
    .describe("Sensible chapter length for this genre, between 800 and 5000"),
  styleNotes: z
    .string()
    .describe(
      "Concrete prose rules for this novel: sentence rhythm, imagery density, dialogue style, comparable authors, and what to avoid. Written as directives to a writer.",
    ),
});

const bodySchema = z.object({ novelId: z.uuid() });

/** Proposes a style profile from the premise. The author always confirms it. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { novelId } = parsed.data;

  const db = getDb();
  const [novel] = await db.select().from(novels).where(eq(novels.id, novelId));
  if (!novel) {
    return NextResponse.json({ error: "Novel not found" }, { status: 404 });
  }
  if (!novel.premise.trim()) {
    return NextResponse.json(
      { error: "Write a premise first — there is nothing to derive a style from." },
      { status: 400 },
    );
  }

  const started = Date.now();
  const { output, usage } = await generateText({
    model: MODELS.writing,
    instructions:
      NOVELIST_PERSONA +
      ` You are advising on the house style for a new novel. Be opinionated and specific — a style profile that would fit any book is useless.`,
    output: Output.object({ schema: styleSchema }),
    prompt: `# Novel: ${novel.title}\nPremise: ${novel.premise}\n\n---\nTask: Propose the style profile this novel should be written in.`,
  });

  await logGeneration({
    novelId,
    route: "style",
    model: MODELS.writing,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    durationMs: Date.now() - started,
  });

  return NextResponse.json({
    ...output,
    targetChapterWords: Math.min(
      5000,
      Math.max(800, Math.round(output.targetChapterWords)),
    ),
  });
}
