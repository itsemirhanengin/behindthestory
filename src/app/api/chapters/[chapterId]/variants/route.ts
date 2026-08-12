import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, chapters } from "@/db";

type Params = { params: Promise<{ chapterId: string }> };

/** "" → "B" → "C" ... The original draft carries no label. */
function nextLabel(taken: string[]): string {
  for (let code = "B".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
    const label = String.fromCharCode(code);
    if (!taken.includes(label)) return label;
  }
  throw new Error("This chapter already has every variant label A–Z.");
}

export async function GET(_req: Request, { params }: Params) {
  const { chapterId } = await params;
  const db = getDb();
  const [chapter] = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }
  const siblings = await db
    .select()
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, chapter.novelId),
        eq(chapters.number, chapter.number),
      ),
    );
  siblings.sort((a, b) => a.variantLabel.localeCompare(b.variantLabel));
  return NextResponse.json(siblings);
}

/**
 * Starts an alternative take of this chapter: same slot, same plan, empty
 * prose. Revisions are the history of one take; variants are parallel takes.
 */
export async function POST(_req: Request, { params }: Params) {
  const { chapterId } = await params;
  const db = getDb();
  const [source] = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  if (!source) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  const siblings = await db
    .select({ variantLabel: chapters.variantLabel })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, source.novelId),
        eq(chapters.number, source.number),
      ),
    );

  let label: string;
  try {
    label = nextLabel(siblings.map((s) => s.variantLabel));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const [created] = await db
    .insert(chapters)
    .values({
      novelId: source.novelId,
      number: source.number,
      variantLabel: label,
      // The new take is inert until the author switches to it, which also
      // keeps the one-active-variant-per-slot index satisfied.
      isActive: false,
      act: source.act,
      title: source.title,
      outline: source.outline,
      beats: source.beats.map((b) => ({ ...b, done: false })),
      continuesFromPrevious: source.continuesFromPrevious,
      content: "",
      summary: "",
      status: "draft",
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
