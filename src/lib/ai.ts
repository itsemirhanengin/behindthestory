import { getDb, aiGenerations, type Novel } from "@/db";

/**
 * Gateway model strings. Writing wants the strongest model; extraction and
 * critique are cheaper jobs that do not need it.
 */
export const MODELS = {
  writing: process.env.AI_MODEL ?? "anthropic/claude-opus-5",
  utility: process.env.AI_UTILITY_MODEL ?? "anthropic/claude-sonnet-5",
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

/**
 * Records what a generation cost. Failures here must never break a generation,
 * so everything is swallowed and logged.
 */
export async function logGeneration(entry: {
  novelId: string;
  chapterId?: string | null;
  route: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}) {
  try {
    await getDb()
      .insert(aiGenerations)
      .values({
        novelId: entry.novelId,
        chapterId: entry.chapterId ?? null,
        route: entry.route,
        model: entry.model,
        inputTokens: Math.round(entry.inputTokens ?? 0),
        outputTokens: Math.round(entry.outputTokens ?? 0),
        durationMs: Math.round(entry.durationMs ?? 0),
      });
  } catch (error) {
    console.error("[ai] failed to log generation", error);
  }
}
