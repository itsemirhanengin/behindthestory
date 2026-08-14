import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, aiGenerations } from "@behindthestory/db";

type Params = { params: Promise<{ novelId: string }> };

/** Aggregate AI spend for this novel, so generation cost is not invisible. */
export async function GET(_req: Request, { params }: Params) {
  const { novelId } = await params;
  const db = getDb();

  const [totals] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiGenerations.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiGenerations.outputTokens}), 0)::int`,
    })
    .from(aiGenerations)
    .where(eq(aiGenerations.novelId, novelId));

  const byRoute = await db
    .select({
      route: aiGenerations.route,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiGenerations.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiGenerations.outputTokens}), 0)::int`,
    })
    .from(aiGenerations)
    .where(eq(aiGenerations.novelId, novelId))
    .groupBy(aiGenerations.route)
    .orderBy(desc(sql`count(*)`));

  return NextResponse.json({ totals, byRoute });
}
