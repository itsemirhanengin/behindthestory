import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, novels, chapters } from "@behindthestory/db";
import { activeSpine } from "@behindthestory/core/context-builder";

type Params = { params: Promise<{ novelId: string }> };

function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "novel"
  );
}

/**
 * Exports the manuscript as a single Markdown file. Chapters are stored as
 * Markdown already, so this is a concatenation rather than a conversion.
 */
export async function GET(req: Request, { params }: Params) {
  const { novelId } = await params;
  const url = new URL(req.url);
  const includeDrafts = url.searchParams.get("drafts") !== "false";

  const db = getDb();
  const [novel] = await db.select().from(novels).where(eq(novels.id, novelId));
  if (!novel) {
    return NextResponse.json({ error: "Novel not found" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.novelId, novelId));

  // Only the active variant of each slot is part of the manuscript.
  const included = activeSpine(rows).filter(
    (ch) => ch.content.trim() && (includeDrafts || ch.status === "final"),
  );

  const body = included
    .map((ch) => `## Chapter ${ch.number}\n\n### ${ch.title}\n\n${ch.content.trim()}`)
    .join("\n\n---\n\n");

  const markdown = [
    `# ${novel.title}`,
    novel.premise ? `> ${novel.premise}` : "",
    included.length ? body : "_No written chapters yet._",
  ]
    .filter(Boolean)
    .join("\n\n");

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(novel.title)}.md"`,
    },
  });
}
