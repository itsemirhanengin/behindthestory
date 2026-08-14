import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb, chapters, canonChunks } from "@/db";
import { indexChapter } from "@/lib/canon-index";

export const maxDuration = 300;

type Params = { params: Promise<{ chapterId: string }> };

/** Whether this chapter's prose is currently retrievable, and how stale it is. */
export async function GET(_req: Request, { params }: Params) {
  const { chapterId } = await params;
  const db = getDb();
  const [row] = await db
    .select({
      chunks: sql<number>`count(*)::int`,
      indexedAt: sql<string | null>`max(${canonChunks.createdAt})`,
    })
    .from(canonChunks)
    .where(eq(canonChunks.sourceId, chapterId));
  return NextResponse.json(row ?? { chunks: 0, indexedAt: null });
}

export async function POST(_req: Request, { params }: Params) {
  const { chapterId } = await params;
  const db = getDb();
  const [chapter] = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  try {
    const result = await indexChapter(chapter.novelId, chapter);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[canon-index]", error);
    return NextResponse.json(
      {
        error:
          "Failed to index this chapter. Embeddings run through the AI Gateway — check model access and credits.",
      },
      { status: 502 },
    );
  }
}
