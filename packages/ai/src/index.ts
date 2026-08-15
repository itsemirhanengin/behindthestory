import {
  getDb,
  aiGenerations,
  type Novel,
  type UsageSource,
} from "@behindthestory/db";

import {
  DEFAULT_MODEL,
  UTILITY_MODEL,
  embeddingUsdCost,
  usdCost,
  type ModelId,
  type TokenUsage,
} from "./models";

export * from "./models";

/**
 * Gateway model strings.
 *
 * `writing` is only the fallback now — which model a prose generation runs on
 * is a per-workspace choice resolved through `resolveWritingModel` in
 * `@behindthestory/core/plans`, because it is also what the workspace is
 * charged for. Extraction and critique stay pinned to `utility`: the quality
 * difference does not justify the price spread, and a fixed model is what
 * lets those routes carry a published flat price.
 */
export const MODELS = {
  writing: process.env.AI_MODEL ?? DEFAULT_MODEL,
  utility: process.env.AI_UTILITY_MODEL ?? UTILITY_MODEL,
  embedding: process.env.AI_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
} as const;

/** Must match the `vector(...)` dimension on `canon_chunks.embedding`. */
export const EMBEDDING_DIMENSIONS = 1536;

/** Kept as a named export for backwards compatibility with older routes. */
export const AI_MODEL = MODELS.writing;

export const NOVELIST_PERSONA = `You are an expert novelist's assistant working on a serialized, multi-episode novel. You write vivid, coherent prose in English and you deeply respect established canon: character voices, relationship dynamics, planted foreshadowing, and unresolved plot threads. Never contradict the provided story context.`;

const POV_LABELS: Record<Novel["pov"], string> = {
  first: "first person",
  third_limited: "third person limited",
  third_omniscient: "third person omniscient",
};

/**
 * Turns the novel's style profile into a binding directive block. Without this
 * every generation drifts toward generic middle-of-the-road prose.
 */
export function compileStyleDirective(novel: Novel): string {
  const lines: string[] = [
    `- Narration: ${POV_LABELS[novel.pov]}, ${novel.tense} tense. Do not switch.`,
  ];
  if (novel.genre) lines.push(`- Genre: ${novel.genre}`);
  if (novel.tone) lines.push(`- Tone: ${novel.tone}`);
  if (novel.targetChapterWords > 0) {
    lines.push(`- Target chapter length: ~${novel.targetChapterWords} words`);
  }
  if (novel.styleNotes) lines.push(`- Author's prose rules: ${novel.styleNotes}`);
  return `## Style contract (binding)\n${lines.join("\n")}`;
}

export type GenerationRecord = {
  workspaceId: string;
  userId?: string | null;
  novelId?: string | null;
  chapterId?: string | null;
  route: string;
  model: ModelId;
  usage: TokenUsage;
  wordsCharged: number;
  durationMs?: number;
  /** Idempotency key, shared with this generation's ledger rows. */
  requestId: string;
  source?: UsageSource;
};

/**
 * Records what a generation cost, and what the workspace was charged for it.
 *
 * This used to swallow every error on the grounds that a failed log must not
 * break a generation. That was right when the row was analytics. It is now the
 * evidence behind a bill and the join target for the ledger, so a write that
 * fails has to be visible: the caller runs it inside the same settle path that
 * moves the balance, and a silent loss there is revenue that no longer exists.
 */
export async function recordGeneration(entry: GenerationRecord) {
  const [row] = await getDb()
    .insert(aiGenerations)
    .values({
      workspaceId: entry.workspaceId,
      userId: entry.userId ?? null,
      novelId: entry.novelId ?? null,
      chapterId: entry.chapterId ?? null,
      route: entry.route,
      model: entry.model,
      inputTokens: Math.round(entry.usage.inputTokens ?? 0),
      outputTokens: Math.round(entry.usage.outputTokens ?? 0),
      cacheReadTokens: Math.round(entry.usage.cacheReadTokens ?? 0),
      cacheWriteTokens: Math.round(entry.usage.cacheWriteTokens ?? 0),
      reasoningTokens: Math.round(entry.usage.reasoningTokens ?? 0),
      usdCost: usdCost(entry.model, entry.usage).toFixed(6),
      wordsCharged: Math.round(entry.wordsCharged),
      source: entry.source ?? "platform",
      requestId: entry.requestId,
      durationMs: Math.round(entry.durationMs ?? 0),
    })
    .onConflictDoNothing({ target: aiGenerations.requestId })
    .returning({ id: aiGenerations.id });

  return row?.id ?? null;
}

/**
 * Records an embedding call.
 *
 * Separate from `recordGeneration` because the embedding model is not on the
 * catalogue — it is chosen by the vector column's dimension, not by the
 * writer, and it has no output side to price.
 *
 * Charged at zero words: indexing a chapter costs about $0.00005, and a line
 * item that small costs more in explaining than it recovers. It is recorded so
 * that "where is the money going" has a complete answer.
 */
export async function recordEmbedding(entry: {
  workspaceId: string;
  novelId?: string | null;
  chapterId?: string | null;
  tokens: number;
  durationMs?: number;
  requestId: string;
}) {
  await getDb()
    .insert(aiGenerations)
    .values({
      workspaceId: entry.workspaceId,
      novelId: entry.novelId ?? null,
      chapterId: entry.chapterId ?? null,
      route: "embedding",
      model: MODELS.embedding,
      inputTokens: Math.round(entry.tokens),
      usdCost: embeddingUsdCost(entry.tokens).toFixed(6),
      wordsCharged: 0,
      requestId: entry.requestId,
      durationMs: Math.round(entry.durationMs ?? 0),
    })
    .onConflictDoNothing({ target: aiGenerations.requestId });
}
