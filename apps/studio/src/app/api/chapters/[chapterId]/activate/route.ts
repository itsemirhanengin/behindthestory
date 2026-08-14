import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getDb, chapters } from "@/db";

type Params = { params: Promise<{ chapterId: string }> };

/**
 * Makes this variant the one that counts for its slot — what the reader, the
 * export and every AI context see.
 *
 * The siblings are stood down first: the partial unique index allows only one
 * active variant per slot, so activating before deactivating would be rejected.
 */
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
  if (chapter.isActive) return NextResponse.json(chapter);

  await db
    .update(chapters)
    .set({ isActive: false })
    .where(
      and(
        eq(chapters.novelId, chapter.novelId),
        eq(chapters.number, chapter.number),
        ne(chapters.id, chapterId),
      ),
    );

  const [updated] = await db
    .update(chapters)
    .set({ isActive: true })
    .where(eq(chapters.id, chapterId))
    .returning();

  return NextResponse.json(updated);
}
