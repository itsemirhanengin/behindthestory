import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { POV_VALUES, TENSE_VALUES } from "@behindthestory/db";
import { MODELS, NOVELIST_PERSONA } from "@behindthestory/ai";
import {
  CHAPTER_WORDS,
  type StyleProposal,
  type StyleResponse,
} from "@behindthestory/core/onboarding";

export const maxDuration = 300;

const styleSchema = z.object({
  genre: z.string().describe("Genre and subgenre, e.g. 'literary thriller'"),
  tone: z.string().describe("Three to five mood descriptors, comma separated"),
  pov: z.enum(POV_VALUES),
  tense: z.enum(TENSE_VALUES),
  targetChapterWords: z
    .number()
    .describe(
      `Chapter length that suits this novel, between ${CHAPTER_WORDS.min} and ${CHAPTER_WORDS.max} words`,
    ),
  styleNotes: z
    .string()
    .describe(
      "Concrete prose rules for this novel, one per line, written as directives to a writer: sentence rhythm, imagery density, dialogue handling, and what to avoid. Name comparable authors only where it sharpens a rule.",
    ),
  rationale: z
    .object({
      genre: z.string(),
      tone: z.string(),
      narration: z.string(),
      length: z.string(),
      styleNotes: z.string(),
    })
    .describe(
      "One short clause per field — under 20 words — saying why THIS novel wants that setting. The author reads these to decide whether to trust the autofill, so 'it fits the genre' is worthless.",
    ),
}) satisfies z.ZodType<StyleProposal>;

const readingSchema = z.object({
  logline: z.string().max(2_000),
  premise: z.string().max(20_000),
  protagonist: z.string().max(4_000),
  conflict: z.string().max(4_000),
  world: z.string().max(4_000),
  stakes: z.string().max(4_000),
  themes: z.array(z.string().max(200)).max(8),
});

const bodySchema = z.object({
  title: z.string().max(300).default(""),
  reading: readingSchema,
});

/** Snaps to the slider's own grid so the proposed value is one the author can
 *  reproduce by hand, and keeps the column inside its documented range. */
function snapWords(value: number): number {
  const { min, max, step } = CHAPTER_WORDS;
  const clamped = Math.min(max, Math.max(min, Math.round(value || min)));
  return Math.round(clamped / step) * step;
}

/**
 * Derives the style contract from the reading the author already signed off on.
 * Nothing here is binding — the wizard renders every value as an editable
 * control with its rationale attached.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid request: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    );
  }
  const { title, reading } = parsed.data;

  const started = Date.now();
  const { output, usage } = await generateText({
    model: MODELS.writing,
    instructions:
      NOVELIST_PERSONA +
      ` You are setting the house style for a new novel. Be opinionated: a style profile that would fit any book is worse than none, because it will be obeyed on every chapter for the life of the novel.`,
    output: Output.object({ schema: styleSchema }),
    prompt: `# Novel: ${title.trim() || "(untitled)"}
Logline: ${reading.logline}
Premise: ${reading.premise}
Protagonist: ${reading.protagonist}
Conflict: ${reading.conflict}
World: ${reading.world}
Stakes: ${reading.stakes}
Themes: ${reading.themes.join(", ")}

---
Task: Propose the style contract this novel should be written under, and justify each choice against this specific story.`,
  });

  const style: StyleProposal = {
    ...output,
    targetChapterWords: snapWords(output.targetChapterWords),
  };

  const body: StyleResponse = {
    style,
    usage: {
      route: "onboarding-style",
      model: MODELS.writing,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      durationMs: Date.now() - started,
    },
  };
  return NextResponse.json(body);
}
