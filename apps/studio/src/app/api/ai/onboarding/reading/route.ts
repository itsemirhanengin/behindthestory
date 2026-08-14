import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { MODELS, NOVELIST_PERSONA } from "@/lib/ai";
import {
  MIN_DESCRIPTION_WORDS,
  countWords,
  type Reading,
  type ReadingResponse,
} from "@/lib/onboarding";

export const maxDuration = 300;

/**
 * `satisfies` rather than a bare annotation: the concrete zod type is what the
 * SDK needs to build a JSON schema, while the check makes a drift between this
 * schema and the wizard's `Reading` type a compile error.
 */
const readingSchema = z.object({
  titleSuggestions: z
    .array(z.string())
    .describe(
      "Two or three title candidates, strongest first. Fill this even if the author already named the book.",
    ),
  logline: z
    .string()
    .describe(
      "One sentence under 40 words: who wants what, and what stands in the way.",
    ),
  premise: z
    .string()
    .describe(
      "One paragraph — the spine of the novel, in the author's own terms. Every future generation for this novel is anchored to this text, so it must be concrete and load-bearing rather than atmospheric. No marketing voice.",
    ),
  protagonist: z
    .string()
    .describe("Who the book follows and what they want. One or two sentences."),
  conflict: z
    .string()
    .describe("The central opposition. One or two sentences."),
  world: z
    .string()
    .describe(
      "Setting, era, and the rules of the world that matter. One or two sentences.",
    ),
  stakes: z
    .string()
    .describe("What is lost if the protagonist fails. One or two sentences."),
  themes: z
    .array(z.string())
    .describe("Two to five short theme phrases, e.g. 'inherited guilt'."),
  assumptions: z
    .array(z.string())
    .describe(
      "Two to five things you inferred that the author did NOT actually say. Be specific and honest — the author reads this list to catch a misreading, so padding it with things they did say defeats its purpose.",
    ),
  questions: z
    .array(z.string())
    .describe(
      "Two to four questions whose answers would genuinely change the book. Skip anything you can reasonably decide yourself.",
    ),
  changeNote: z
    .string()
    .describe(
      "If corrections were given, one sentence naming what you changed in response. Empty string on the first reading.",
    ),
}) satisfies z.ZodType<Reading>;

const bodySchema = z.object({
  title: z.string().max(300).default(""),
  description: z.string().min(1).max(40_000),
  corrections: z.array(z.string().max(4_000)).max(24).default([]),
  previous: readingSchema.nullable().default(null),
});

const clean = (values: string[], limit: number) =>
  values
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, limit);

/** Renders the previous reading as prose — cheaper for the model to read than
 *  JSON, and it keeps the model from pattern-matching its own output verbatim. */
function describePrevious(previous: Reading): string {
  return [
    `Logline: ${previous.logline}`,
    `Premise: ${previous.premise}`,
    `Protagonist: ${previous.protagonist}`,
    `Conflict: ${previous.conflict}`,
    `World: ${previous.world}`,
    `Stakes: ${previous.stakes}`,
    `Themes: ${previous.themes.join(", ")}`,
  ].join("\n");
}

/**
 * Reads the author's description back to them before a single word is written.
 *
 * The novel row does not exist yet — this deliberately runs on raw text so an
 * abandoned wizard leaves nothing behind. Usage is returned to the client and
 * logged against the novel once it is created.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid request: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    );
  }
  const { title, description, corrections, previous } = parsed.data;

  if (countWords(description) < MIN_DESCRIPTION_WORDS) {
    return NextResponse.json(
      {
        error: `Describe the novel in at least ${MIN_DESCRIPTION_WORDS} words — below that there is nothing to read, only something to invent.`,
      },
      { status: 400 },
    );
  }

  const rounds = clean(corrections, 24);
  const sections = [
    `# The author's description`,
    title.trim() ? `Working title: ${title.trim()}` : `(untitled so far)`,
    description.trim(),
  ];
  if (rounds.length) {
    sections.push(
      `## Corrections the author has given you, oldest first\n${rounds
        .map((c, i) => `${i + 1}. ${c}`)
        .join("\n")}`,
    );
  }
  if (previous) {
    sections.push(`## Your previous reading\n${describePrevious(previous)}`);
  }

  const started = Date.now();
  const { output, usage } = await generateText({
    model: MODELS.writing,
    instructions:
      NOVELIST_PERSONA +
      ` You are in the pre-writing interview for a novel that does not exist yet. Your job is to prove you understood the author, not to impress them: no flattery, no embellishment, no plot you were not given. Where the description is silent you may infer — but every inference must be declared.`,
    output: Output.object({ schema: readingSchema }),
    prompt: `${sections.join("\n\n")}

---
Task: Report back what you understand this novel to be.

Rules:
- Work only from the description and the corrections. Do not invent plot to fill space.
- Apply every correction the author has given you. If any are present, say what changed in \`changeNote\`.
- \`assumptions\` is the field the author audits. List what you decided for them, not what they told you.
- \`premise\` is the paragraph the whole novel will be generated against. Make it specific enough to constrain a chapter and short enough to read in one breath.`,
  });

  const reading: Reading = {
    ...output,
    titleSuggestions: clean(output.titleSuggestions, 3),
    themes: clean(output.themes, 5),
    assumptions: clean(output.assumptions, 5),
    questions: clean(output.questions, 4),
    changeNote: rounds.length ? output.changeNote.trim() : "",
  };

  const body: ReadingResponse = {
    reading,
    usage: {
      route: "onboarding-reading",
      model: MODELS.writing,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      durationMs: Date.now() - started,
    },
  };
  return NextResponse.json(body);
}
