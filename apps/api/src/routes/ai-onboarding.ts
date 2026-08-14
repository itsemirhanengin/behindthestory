import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { generateText, Output } from "ai";
import { z } from "zod";

import { POV_VALUES, TENSE_VALUES } from "@behindthestory/db";
import { MODELS, NOVELIST_PERSONA } from "@behindthestory/ai";
import {
  CHAPTER_WORDS,
  MIN_DESCRIPTION_WORDS,
  countWords,
  type Reading,
  type ReadingResponse,
  type StyleProposal,
  type StyleResponse,
} from "@behindthestory/core/onboarding";

import { requireAuth, type AuthEnv } from "#middleware/auth";

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
  conflict: z.string().describe("The central opposition. One or two sentences."),
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

const clean = (values: string[], limit: number) =>
  values
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, limit);

/** Snaps to the slider's own grid so the proposed value is one the author can
 *  reproduce by hand, and keeps the column inside its documented range. */
function snapWords(value: number): number {
  const { min, max, step } = CHAPTER_WORDS;
  const clamped = Math.min(max, Math.max(min, Math.round(value || min)));
  return Math.round(clamped / step) * step;
}

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
 * The pre-writing interview.
 *
 * These run before a novel row exists, so there is nothing to check ownership
 * against — a signed-in account is the whole requirement. An abandoned wizard
 * leaves nothing behind, and usage is logged against the novel once created.
 */
export const aiOnboardingRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .post(
    "/reading",
    zValidator(
      "json",
      z.object({
        title: z.string().max(300).default(""),
        description: z.string().min(1).max(40_000),
        corrections: z.array(z.string().max(4_000)).max(24).default([]),
        previous: readingSchema.nullable().default(null),
      }),
    ),
    async (c) => {
      const { title, description, corrections, previous } = c.req.valid("json");

      if (countWords(description) < MIN_DESCRIPTION_WORDS) {
        return c.json(
          {
            error: `Describe the novel in at least ${MIN_DESCRIPTION_WORDS} words — below that there is nothing to read, only something to invent.`,
          },
          400,
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
            .map((correction, i) => `${i + 1}. ${correction}`)
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
      return c.json(body);
    },
  )
  /**
   * Derives the style contract from the reading the author already signed off
   * on. Nothing here is binding — the wizard renders every value as an editable
   * control with its rationale attached.
   */
  .post(
    "/style",
    zValidator(
      "json",
      z.object({
        title: z.string().max(300).default(""),
        reading: z.object({
          logline: z.string().max(2_000),
          premise: z.string().max(20_000),
          protagonist: z.string().max(4_000),
          conflict: z.string().max(4_000),
          world: z.string().max(4_000),
          stakes: z.string().max(4_000),
          themes: z.array(z.string().max(200)).max(8),
        }),
      }),
    ),
    async (c) => {
      const { title, reading } = c.req.valid("json");

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
      return c.json(body);
    },
  );
