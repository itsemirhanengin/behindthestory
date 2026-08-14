import { eq } from "drizzle-orm";

import { indexChapter } from "@behindthestory/core/canon-index";
import { chapters, getDb } from "@behindthestory/db";
import type { ChapterIndexJob } from "@behindthestory/jobs/queues";

/**
 * Re-reads the chapter instead of taking its prose from the job payload. The
 * job may have waited behind others, and indexing the text as it is now is
 * both cheaper than carrying it through Redis and closer to what the writer
 * expects to be searchable.
 */
export async function processChapterIndex(payload: ChapterIndexJob) {
  const [chapter] = await getDb()
    .select()
    .from(chapters)
    .where(eq(chapters.id, payload.chapterId))
    .limit(1);

  // Deleted between enqueue and run. Nothing to index and nothing to retry.
  if (!chapter) return { chunks: 0, skipped: "chapter no longer exists" as const };

  const result = await indexChapter(payload.novelId, chapter);
  return result;
}
