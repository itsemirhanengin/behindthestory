import { embed, embedMany } from "ai";
import { and, cosineDistance, desc, eq, gt, ne, sql } from "drizzle-orm";
import { getDb, canonChunks, type Chapter } from "@behindthestory/db";
import { MODELS } from "@behindthestory/ai";
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

  const { embeddings } = await embedMany({
    model: MODELS.embedding,
    values: chunks,
  });

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
