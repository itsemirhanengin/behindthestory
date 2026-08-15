import { embed, embedMany } from "ai";
import { and, cosineDistance, desc, eq, gt, ne, sql } from "drizzle-orm";
import { getDb, canonChunks, novels, type Chapter } from "@behindthestory/db";
import { MODELS, recordEmbedding } from "@behindthestory/ai";
import { estimateTokens, type RetrievedPassage } from "./context-builder";

/** Target size of an indexed passage. Big enough to hold a scene beat. */
const CHUNK_TOKENS = 700;
/** Passages below this cosine similarity are noise, not canon. */
const MIN_SIMILARITY = 0.25;

/**
 * Splits chapter prose on paragraph boundaries, carrying the last paragraph of
 * each chunk into the next so a passage is never cut mid-thought.
 */
export function chunkProse(content: string): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let tokens = 0;

  for (const paragraph of paragraphs) {
    const cost = estimateTokens(paragraph);
    if (tokens + cost > CHUNK_TOKENS && current.length > 0) {
      chunks.push(current.join("\n\n"));
      // One paragraph of overlap keeps context across the seam.
      const carry = current[current.length - 1];
      current = [carry];
      tokens = estimateTokens(carry);
    }
    current.push(paragraph);
    tokens += cost;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

/**
 * Rebuilds the embedded index for one chapter. Existing chunks are replaced,
 * so calling this repeatedly is safe.
 */
export async function indexChapter(
  novelId: string,
  chapter: Chapter,
): Promise<{ chunks: number }> {
  const db = getDb();
  await db.delete(canonChunks).where(eq(canonChunks.sourceId, chapter.id));

  const chunks = chunkProse(chapter.content);
  if (chunks.length === 0) return { chunks: 0 };

  const started = Date.now();
  const { embeddings, usage } = await embedMany({
    model: MODELS.embedding,
    values: chunks,
  });

  /**
   * The only AI spend that used to be completely invisible: this runs in the
   * worker on every chapter save, so nobody watching a novel's usage panel
   * ever saw it. Charged at zero words — see `recordEmbedding` — but no longer
   * missing from the ledger.
   *
   * Retrieval embedding, in `retrievePassages` below, is deliberately not
   * recorded: it costs about four millionths of a dollar and belongs to the
   * generation that triggered it, which is already being metered.
   */
  const [novel] = await db
    .select({ workspaceId: novels.workspaceId })
    .from(novels)
    .where(eq(novels.id, novelId));

  if (novel?.workspaceId) {
    await recordEmbedding({
      workspaceId: novel.workspaceId,
      novelId,
      chapterId: chapter.id,
      tokens: usage.tokens,
      durationMs: Date.now() - started,
      requestId: `embedding:${chapter.id}:${Date.now()}`,
    });
  }

  await db.insert(canonChunks).values(
    chunks.map((content, seq) => ({
      novelId,
      sourceType: "chapter" as const,
      sourceId: chapter.id,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      seq,
      content,
      embedding: embeddings[seq],
    })),
  );

  return { chunks: chunks.length };
}

/**
 * Finds passages from earlier chapters that are semantically relevant to what
 * is about to be written. This is what keeps a long novel coherent once the
 * chapter summaries alone stop being enough.
 */
export async function retrievePassages(
  novelId: string,
  query: string,
  opts: { excludeChapterId?: string; limit?: number } = {},
): Promise<RetrievedPassage[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const db = getDb();
  const { embedding } = await embed({
    model: MODELS.embedding,
    value: trimmed,
  });

  const similarity = sql<number>`1 - (${cosineDistance(canonChunks.embedding, embedding)})`;

  const rows = await db
    .select({
      chapterNumber: canonChunks.chapterNumber,
      chapterTitle: canonChunks.chapterTitle,
      content: canonChunks.content,
      similarity,
    })
    .from(canonChunks)
    .where(
      and(
        eq(canonChunks.novelId, novelId),
        gt(similarity, MIN_SIMILARITY),
        opts.excludeChapterId
          ? ne(canonChunks.sourceId, opts.excludeChapterId)
          : undefined,
      ),
    )
    .orderBy(desc(similarity))
    .limit(opts.limit ?? 6);

  return rows;
}

/**
 * Builds the retrieval query from everything that describes the scene about to
 * be written: the author's direction, who and where it involves, and the tail
 * of the draft.
 */
export function buildRetrievalQuery(input: {
  chapterTitle?: string;
  instruction?: string;
  entityNames?: string[];
  draftTail?: string;
}): string {
  return [
    input.instruction,
    input.entityNames?.join(", "),
    input.chapterTitle,
    input.draftTail?.slice(-800),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
}
