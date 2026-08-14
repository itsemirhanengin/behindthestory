import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@behindthestory/ai";
import {
  loadNovelBundle,
  buildStoryContext,
  estimateTokens,
  activeSpine,
} from "@behindthestory/core/context-builder";

export const maxDuration = 300;

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      sourceCharacterId: z.string(),
      targetCharacterId: z.string(),
      type: z.enum([
        "family",
        "romance",
        "friendship",
        "rivalry",
        "mentor",
        "enemy",
        "ally",
        "other",
      ]),
      closeness: z.number().describe("1-10, how close/intense the bond is"),
      description: z.string(),
      reasoning: z
        .string()
        .describe("Which chapter events or facts support this"),
      // A bond enters the timeline somewhere. Guessing "chapter 1" for a pair
      // who only meet in chapter 40 would backdate the relationship across the
      // whole novel, so the model is asked where it actually starts.
      startChapterNumber: z
        .number()
        .describe(
          "The earliest chapter where this bond is evident. Use 0 if it predates the novel (e.g. family, shared history)",
        ),
    }),
  ),
});

const bodySchema = z.object({ novelId: z.uuid() });

/** Ceiling for the raw chapter prose used as evidence, in estimated tokens. */
const EVIDENCE_BUDGET = 30_000;

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { novelId } = parsed.data;

  const bundle = await loadNovelBundle(novelId);
  const context = buildStoryContext(bundle);

  const roster = bundle.characters.map((c) => `${c.id} = ${c.name}`).join("\n");
  const existingPairs = new Set(
    bundle.relationships.flatMap((r) => [
      `${r.sourceCharacterId}:${r.targetCharacterId}`,
      `${r.targetCharacterId}:${r.sourceCharacterId}`,
    ]),
  );

  // Newest chapters are the best evidence for what a relationship is *now*, so
  // they get the full text and older ones degrade to their summary.
  const written = activeSpine(bundle.chapters).filter((ch) => ch.content.trim());
  const blocks: string[] = [];
  let spent = 0;
  let degraded = 0;
  for (const ch of [...written].reverse()) {
    const full = `### Chapter ${ch.number}: ${ch.title}\n${ch.content}`;
    const cost = estimateTokens(full);
    if (spent + cost <= EVIDENCE_BUDGET) {
      blocks.unshift(full);
      spent += cost;
    } else {
      degraded++;
      if (ch.summary) {
        blocks.unshift(`### Chapter ${ch.number}: ${ch.title} (summary only)\n${ch.summary}`);
      }
    }
  }
  const evidence = blocks.length
    ? blocks.join("\n\n") +
      (degraded
        ? `\n\n(${degraded} earlier chapter(s) shown as summary only to stay within the context budget)`
        : "")
    : "(no chapters written yet — infer from character profiles and premise)";

  const started = Date.now();
  const { output, usage } = await generateText({
    model: MODELS.utility,
    instructions: NOVELIST_PERSONA,
    output: Output.object({ schema: suggestionSchema }),
    prompt: `${context.text}\n\n## Chapter evidence\n${evidence}\n\n---\nTask: Suggest relationships between characters that are implied by the story but NOT yet recorded in the Relationships section. Use ONLY these character ids:\n${roster}\n\nDo not suggest a pair that already has a relationship. Return an empty list if nothing new is implied.`,
  });

  await logGeneration({
    novelId,
    route: "relationships",
    model: MODELS.utility,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    durationMs: Date.now() - started,
  });

  const validIds = new Set(bundle.characters.map((c) => c.id));
  const fresh = output.suggestions.filter(
    (s) =>
      validIds.has(s.sourceCharacterId) &&
      validIds.has(s.targetCharacterId) &&
      s.sourceCharacterId !== s.targetCharacterId &&
      !existingPairs.has(`${s.sourceCharacterId}:${s.targetCharacterId}`),
  );

  return NextResponse.json({ suggestions: fresh });
}
