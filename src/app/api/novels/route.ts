import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, novels, POV_VALUES, TENSE_VALUES } from "@/db";
import { logGeneration } from "@/lib/ai";

export async function GET() {
  const db = getDb();
  const rows = await db.select().from(novels).orderBy(desc(novels.createdAt));
  return NextResponse.json(rows);
}

/**
 * The new-novel wizard sends the whole style contract in one shot, since it has
 * already had the author confirm every field. Everything except the title stays
 * optional so the column defaults still apply to a bare `{ title }` create.
 */
const createSchema = z.object({
  title: z.string().min(1, "title is required").max(300),
  premise: z.string().max(20_000).default(""),
  genre: z.string().max(200).optional(),
  tone: z.string().max(500).optional(),
  pov: z.enum(POV_VALUES).optional(),
  tense: z.enum(TENSE_VALUES).optional(),
  targetChapterWords: z.number().int().min(200).max(20_000).optional(),
  styleNotes: z.string().max(20_000).optional(),
  /**
   * Generations spent inside the wizard, before this novel had an id to log
   * them against. Client-reported by necessity — the alternative is that the
   * two calls that shaped the entire novel are the only ones missing from its
   * cost breakdown.
   */
  aiUsage: z
    .array(
      z.object({
        route: z.string().max(60),
        model: z.string().max(200),
        inputTokens: z.number().int().min(0).max(10_000_000),
        outputTokens: z.number().int().min(0).max(10_000_000),
        durationMs: z.number().int().min(0).max(3_600_000),
      }),
    )
    .max(40)
    .default([]),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { aiUsage, ...values } = parsed.data;

  const db = getDb();
  const [row] = await db.insert(novels).values(values).returning();

  for (const entry of aiUsage) {
    await logGeneration({ novelId: row.id, ...entry });
  }

  return NextResponse.json(row, { status: 201 });
}
