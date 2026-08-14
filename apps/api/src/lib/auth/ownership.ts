import { and, eq } from "drizzle-orm";

import { chapters, getDb, novels } from "@behindthestory/db";

/**
 * The whole authorisation model.
 *
 * Every table in the graph reaches a novel through `novel_id` (and
 * `chapter_revisions` through its chapter), so "may this account touch this
 * data" reduces to "does this account own that novel". One edge, checked here.
 *
 * A novel with a null owner predates auth and belongs to nobody: the equality
 * below never matches it, so it stays unreachable until `db:claim` assigns it.
 */
export async function ownsNovel(userId: string, novelId: string) {
  const [row] = await getDb()
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.ownerId, userId)));
  return Boolean(row);
}

/** Same check, entered from a chapter id. */
export async function ownsChapter(userId: string, chapterId: string) {
  const [row] = await getDb()
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(eq(chapters.id, chapterId), eq(novels.ownerId, userId)));
  return Boolean(row);
}

/**
 * 404 rather than 403 on purpose: a 403 confirms the id exists, which lets
 * someone enumerate other writers' novels one uuid at a time.
 */
export function notFound() {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}
