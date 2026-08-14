import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, chapters, chapterRevisions } from "@behindthestory/db";

type Params = { params: Promise<{ chapterId: string }> };

/** Snapshots kept per chapter. Older ones are pruned beyond this. */
const MAX_REVISIONS = 40;

export async function GET(_req: Request, { params }: Params) {
  const { chapterId } = await params;
  const db = getDb();
  const rows = await db
    .select({
      id: chapterRevisions.id,
      label: chapterRevisions.label,
      wordCount: chapterRevisions.wordCount,
      createdAt: chapterRevisions.createdAt,
    })
    .from(chapterRevisions)
    .where(eq(chapterRevisions.chapterId, chapterId))
    .orderBy(desc(chapterRevisions.createdAt));
  return NextResponse.json(rows);
}

const postSchema = z.object({
  label: z.string().max(120).default("manual"),
  /** Optional; when omitted the chapter's current content is snapshotted. */
  content: z.string().optional(),
});

export async function POST(req: Request, { params }: Params) {
  const { chapterId } = await params;
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = getDb();
  const [chapter] = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  const content = parsed.data.content ?? chapter.content;
  if (!content.trim()) {
    return NextResponse.json(
      { error: "Nothing to snapshot — the chapter is empty." },
      { status: 400 },
    );
  }

  const existing = await db
    .select({ id: chapterRevisions.id, content: chapterRevisions.content })
    .from(chapterRevisions)
    .where(eq(chapterRevisions.chapterId, chapterId))
    .orderBy(desc(chapterRevisions.createdAt));

  // Never stack identical snapshots — hitting "save version" twice in a row
  // should not bury the history.
  if (existing[0]?.content === content) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const [row] = await db
    .insert(chapterRevisions)
    .values({
      chapterId,
      content,
      label: parsed.data.label,
      wordCount: content.trim() ? content.trim().split(/\s+/).length : 0,
    })
    .returning();

  for (const stale of existing.slice(MAX_REVISIONS - 1)) {
    await db.delete(chapterRevisions).where(eq(chapterRevisions.id, stale.id));
  }

  return NextResponse.json(row, { status: 201 });
}
