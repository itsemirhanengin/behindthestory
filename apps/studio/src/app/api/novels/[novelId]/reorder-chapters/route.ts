import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, chapters } from "@behindthestory/db";

type Params = { params: Promise<{ novelId: string }> };

const bodySchema = z.object({
  /** Current slot numbers, in the order they should now read. */
  order: z.array(z.number().int().positive()).min(1),
});

/**
 * Renumbers the spine. All variants of a slot move together, since a slot is
 * one position in reading order regardless of how many drafts it holds.
 *
 * Numbers are parked in the negative range first: the unique index on
 * (novel_id, number) would otherwise reject any reorder that passes through a
 * position another chapter still occupies.
 */
export async function POST(req: Request, { params }: Params) {
  const { novelId } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { order } = parsed.data;

  const db = getDb();
  const existing = await db
    .select({ number: chapters.number })
    .from(chapters)
    .where(eq(chapters.novelId, novelId));

  const slots = [...new Set(existing.map((c) => c.number))].sort((a, b) => a - b);
  const requested = [...new Set(order)];
  if (
    requested.length !== slots.length ||
    !requested.every((n) => slots.includes(n))
  ) {
    return NextResponse.json(
      { error: "The order must list every existing chapter slot exactly once." },
      { status: 400 },
    );
  }

  const mapping = new Map(requested.map((oldNumber, i) => [oldNumber, i + 1]));
  const unchanged = [...mapping].every(([from, to]) => from === to);
  if (unchanged) return NextResponse.json({ ok: true, moved: 0 });

  const cases = sql.join(
    [...mapping].map(
      ([from, to]) => sql`when ${chapters.number} = ${from} then ${-to}`,
    ),
    sql` `,
  );

  await db
    .update(chapters)
    .set({ number: sql`case ${cases} else ${chapters.number} end` })
    .where(eq(chapters.novelId, novelId));

  await db
    .update(chapters)
    .set({ number: sql`-${chapters.number}` })
    .where(sql`${chapters.novelId} = ${novelId} and ${chapters.number} < 0`);

  return NextResponse.json({ ok: true, moved: mapping.size });
}
