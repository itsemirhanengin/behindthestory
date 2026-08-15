import type { Novel } from "@behindthestory/db/schema";

/**
 * Contracts shared by the new-novel wizard and the two AI endpoints behind it.
 *
 * Nothing is written to the database until the last step, so these shapes only
 * ever live in client state and in request bodies. This module deliberately has
 * no runtime dependency on zod or on the drizzle schema — the wizard is a client
 * component and pulling either into the browser bundle would be pure weight.
 * The matching zod schemas live next to the routes that validate with them.
 */

/**
 * The AI's read of what the author described.
 *
 * This is the artefact the author corrects until it is right. Only `premise`
 * (and the title) survive into the novel row; everything else exists to make a
 * misunderstanding *visible* before it hardens into canon.
 */
export type Reading = {
  titleSuggestions: string[];
  logline: string;
  premise: string;
  protagonist: string;
  conflict: string;
  world: string;
  stakes: string;
  themes: string[];
  /** Gaps the model filled in itself — the field the author actually audits. */
  assumptions: string[];
  questions: string[];
  /** One sentence on what the last round of corrections changed. "" at first. */
  changeNote: string;
};

/** Exactly the novel columns the wizard fills. Keyed off the table so a schema
 *  change surfaces here as a type error rather than as a silently dropped field. */
export type StyleFields = Pick<
  Novel,
  "genre" | "tone" | "pov" | "tense" | "targetChapterWords" | "styleNotes"
>;

/** One short justification per control, so the autofill is inspectable. */
export type StyleRationale = {
  genre: string;
  tone: string;
  narration: string;
  length: string;
  styleNotes: string;
};

export type StyleProposal = StyleFields & { rationale: StyleRationale };

/** One round of the author correcting the reading, and the AI's reply to it. */
export type WizardTurn = { correction: string; changeNote: string };

export type ReadingRequest = {
  title: string;
  description: string;
  /** Every correction so far, replayed in order — the reading is re-derived
   *  from scratch each round rather than patched, so it cannot drift. */
  corrections: string[];
  previous: Reading | null;
};

/**
 * No usage travels with these. The wizard used to carry token counts to the
 * end and hand them to `POST /api/novels`, which was the one place a client
 * could dictate what it had spent — fine as analytics, unusable now that the
 * same numbers decide what a workspace is charged. The server meters both
 * calls against the workspace instead.
 */
export type ReadingResponse = { reading: Reading };

export type StyleRequest = { title: string; reading: Reading };

export type StyleResponse = { style: StyleProposal };

export const CHAPTER_WORDS = { min: 600, max: 5000, step: 100 } as const;

/** Below this the model is inventing a novel rather than reading one. */
export const MIN_DESCRIPTION_WORDS = 40;

/** Rough prose reading speed, used for the "≈ N min" hints. */
const WORDS_PER_MINUTE = 250;

export const POV_OPTIONS: { value: Novel["pov"]; label: string }[] = [
  { value: "first", label: "First person" },
  { value: "third_limited", label: "Third limited" },
  { value: "third_omniscient", label: "Third omniscient" },
];

export const TENSE_OPTIONS: { value: Novel["tense"]; label: string }[] = [
  { value: "past", label: "Past tense" },
  { value: "present", label: "Present tense" },
];

export const povLabel = (value: Novel["pov"]) =>
  POV_OPTIONS.find((o) => o.value === value)?.label ?? value;

export const tenseLabel = (value: Novel["tense"]) =>
  TENSE_OPTIONS.find((o) => o.value === value)?.label ?? value;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
