import { and, eq } from "drizzle-orm";

import { chapters, getDb, novels, workspaceMembers } from "@behindthestory/db";

/**
 * The whole authorisation model.
 *
 * Every table in the graph reaches a novel through `novel_id` (and
 * `chapter_revisions` through its chapter), so "may this account touch this
 * data" reduces to "is this account a member of the workspace that owns that
 * novel". One edge, checked here.
 *
 * This used to compare `novels.owner_id` to the caller directly. The join
 * through `workspace_members` is what lets several writers share one novel —
 * and one plan — without any other table learning about it.
 *
 * A novel with a null workspace predates the backfill and belongs to nobody:
 * the join below never matches it, so it stays unreachable until the backfill
 * assigns it.
 */
export async function ownsNovel(userId: string, novelId: string) {
  const [row] = await getDb()
    .select({ id: novels.id })
    .from(novels)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.workspaceId, novels.workspaceId),
    )
    .where(and(eq(novels.id, novelId), eq(workspaceMembers.userId, userId)));
  return Boolean(row);
}

/** Same check, entered from a chapter id. */
export async function ownsChapter(userId: string, chapterId: string) {
  const [row] = await getDb()
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.workspaceId, novels.workspaceId),
    )
    .where(and(eq(chapters.id, chapterId), eq(workspaceMembers.userId, userId)));
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
