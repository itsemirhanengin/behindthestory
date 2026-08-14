import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@behindthestory/ai";
import { buildSceneContext } from "@behindthestory/core/scene-context";

export const maxDuration = 300;

const ISSUE_TYPES = [
  "contradiction",
  "continuity",
  "voice",
  "canon_drift",
  "unearned",
] as const;

const issueSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  type: z.enum(ISSUE_TYPES).describe(
    [
      "contradiction: the text states something the story bible says is false (a dead character acting, a resolved thread re-planted, a changed fact)",
      "continuity: timeline, geography or object tracking does not add up against earlier chapters",
      "voice: a character speaks or behaves against their documented voice, motivation or arc",
      "canon_drift: prose breaks the style contract (POV, tense, tone)",
      "unearned: a turn happens with no setup anywhere in the established story",
    ].join("; "),
  ),
  quote: z
    .string()
    .describe(
      "The exact span of text from the chapter that is wrong, copied verbatim, at most one or two sentences. Must appear in the chapter character for character.",
    ),
  issue: z.string().describe("What is wrong, and what it contradicts"),
  suggestion: z.string().describe("A concrete fix the author could apply"),
});

const responseSchema = z.object({ issues: z.array(issueSchema) });

export type ContinuityIssue = z.infer<typeof issueSchema>;

const bodySchema = z.object({ novelId: z.uuid(), chapterId: z.uuid() });

/**
 * Reads a chapter against the story bible and reports where it breaks canon.
 * Extraction (the analyze route) records what a chapter established; this asks
 * the opposite question — what did it get wrong?
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { novelId, chapterId } = parsed.data;

  const { chapter, context } = await buildSceneContext({
    novelId,
    chapterId,
    // Retrieval is steered by the chapter's own prose: pull up whatever the
    // earlier text says about the same people, places and objects.
    draftTail: "",
  });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }
  if (!chapter.content.trim()) {
    return NextResponse.json({ issues: [] });
  }

  const started = Date.now();
  const { output, usage } = await generateText({
    model: MODELS.utility,
    instructions:
      NOVELIST_PERSONA +
      ` You are acting as a continuity editor, not a writing coach. Report only concrete, checkable conflicts against the provided story context — never taste, pacing or general suggestions for improvement. Every quote must be copied verbatim from the chapter. If the chapter is consistent, return an empty list; a clean chapter is a valid and common result.`,
    output: Output.object({ schema: responseSchema }),
    prompt: `${context.text}

---
## Chapter ${chapter.number}: "${chapter.title}" — the text to check
${chapter.content}

---
Task: Find every place where this chapter conflicts with the story context above — established character facts and status, relationship state, resolved or planted threads, timeline and geography, documented character voice, and the binding style contract. Order the issues by severity.`,
  });

  await logGeneration({
    novelId,
    chapterId,
    route: "continuity",
    model: MODELS.utility,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    durationMs: Date.now() - started,
  });

  // The model occasionally paraphrases a quote; a quote that is not in the
  // chapter cannot be highlighted, so mark it rather than silently failing.
  const issues = output.issues.map((issue) => ({
    ...issue,
    locatable: chapter.content.includes(issue.quote.trim()),
  }));

  return NextResponse.json({ issues });
}
