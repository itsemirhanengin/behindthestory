import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getDb,
  characters,
  relationships,
  storyEvents,
  REL_TYPE_VALUES,
  EVENT_IMPACT_VALUES,
} from "@behindthestory/db";
import { resolveChapterId } from "@behindthestory/core/story-events";

type Params = { params: Promise<{ novelId: string }> };

/**
 * A bond cannot be created without saying what it was when it started — that
 * opening event is what every later "as of chapter N" read anchors to. This
 * route exists (rather than the generic `[entity]` one) purely to keep the
 * relationship and its first event from being writable apart.
 */
const bodySchema = z.object({
  sourceCharacterId: z.uuid(),
  targetCharacterId: z.uuid(),
  description: z.string().default(""),
  significance: z.string().default(""),
  origin: z.enum(["user", "ai"]).default("user"),

  // --- The opening event -------------------------------------------------
  type: z.enum(REL_TYPE_VALUES),
  closeness: z.number().int().min(1).max(10).default(5),
  /** 0 = "this is what they were before the novel opened". */
  startChapterNumber: z.number().int().min(0).default(0),
  cause: z.string().default(""),
  driverCharacterIds: z.array(z.uuid()).default([]),
  impact: z.enum(EVENT_IMPACT_VALUES).default("major"),
});

export async function GET(_req: Request, { params }: Params) {
  const { novelId } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(relationships)
    .where(eq(relationships.novelId, novelId));
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: Params) {
  const { novelId } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid request: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    );
  }
  const body = parsed.data;
  if (body.sourceCharacterId === body.targetCharacterId) {
    return NextResponse.json(
      { error: "a character cannot relate to itself" },
      { status: 400 },
    );
  }

  const db = getDb();
  const cast = await db
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.novelId, novelId));
  const castIds = new Set(cast.map((c) => c.id));
  if (
    !castIds.has(body.sourceCharacterId) ||
    !castIds.has(body.targetCharacterId)
  ) {
    return NextResponse.json(
      { error: "both characters must belong to this novel" },
      { status: 400 },
    );
  }

  // Resolve the citation from the chapter number, so the client only has to
  // know where on the spine the event sits.
  const chapterId = await resolveChapterId(
    novelId,
    body.startChapterNumber,
  );

  const [relationship] = await db
    .insert(relationships)
    .values({
      novelId,
      sourceCharacterId: body.sourceCharacterId,
      targetCharacterId: body.targetCharacterId,
      description: body.description,
      significance: body.significance,
      origin: body.origin,
    })
    .returning();

  // The neon-http driver cannot run interactive transactions, so a failure here
  // would leave a bond with no opening event — unreadable at any chapter. Clean
  // it up rather than leave the timeline in that state.
  try {
    const [event] = await db
      .insert(storyEvents)
      .values({
        novelId,
        relationshipId: relationship.id,
        chapterId,
        chapterNumber: body.startChapterNumber,
        relType: body.type,
        closeness: body.closeness,
        cause: body.cause,
        driverCharacterIds: body.driverCharacterIds.filter((id) =>
          castIds.has(id),
        ),
        impact: body.impact,
        origin: body.origin,
      })
      .returning();
    return NextResponse.json({ relationship, event }, { status: 201 });
  } catch (error) {
    await db.delete(relationships).where(eq(relationships.id, relationship.id));
    return NextResponse.json(
      {
        error: `could not record the opening event: ${(error as Error).message}`,
      },
      { status: 500 },
    );
  }
}
