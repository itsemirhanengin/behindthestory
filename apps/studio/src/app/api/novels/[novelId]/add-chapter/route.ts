import { NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, chapters } from "@/db";

type Params = { params: Promise<{ novelId: string }> };

const bodySchema = z.object({
  /** Insert directly after this slot. Omit to append to the end. */
  afterNumber: z.number().int().positive().optional(),
  title: z.string().max(300).optional(),
});

/**
 * Creates a chapter with a server-assigned slot. The number is never computed
 * on the client: two quick clicks used to produce two chapters claiming the
 * same position, which is exactly how the duplicate "Chapter 2" appeared.
 */
export async function POST(req: Request, { params }: Params) {
  const { novelId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { afterNumber, title } = parsed.data;

  const db = getDb();
  const existing = await db
    .select({ number: chapters.number, act: chapters.act })
    .from(chapters)
    .where(eq(chapters.novelId, novelId));

  const lastNumber = existing.reduce((max, c) => Math.max(max, c.number), 0);
  let slot = lastNumber + 1;

  if (afterNumber !== undefined && afterNumber < lastNumber) {
    slot = afterNumber + 1;
    // Park in the negative range so the shift never passes through a taken
    // slot, which the unique index would reject.
    await db
      .update(chapters)
      .set({ number: sql`-(${chapters.number} + 1)` })
      .where(and(eq(chapters.novelId, novelId), gt(chapters.number, afterNumber)));
    await db
      .update(chapters)
      .set({ number: sql`-${chapters.number}` })
      .where(sql`${chapters.novelId} = ${novelId} and ${chapters.number} < 0`);
  }

  // A new chapter belongs to whatever act it lands in.
  const act =
    existing
      .filter((c) => c.number < slot)
      .sort((a, b) => b.number - a.number)[0]?.act ?? 1;

  const [created] = await db
    .insert(chapters)
    .values({
      novelId,
      number: slot,
      act,
      title: title ?? `Chapter ${slot}`,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
