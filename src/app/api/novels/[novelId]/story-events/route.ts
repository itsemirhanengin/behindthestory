import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getDb,
  characters,
  relationships,
  storyEvents,
  REL_TYPE_VALUES,
  CHAR_STATUS_VALUES,
  EVENT_IMPACT_VALUES,
} from "@/db";
import { resolveChapterId } from "@/lib/story-events";

type Params = { params: Promise<{ novelId: string }> };

/**
 * Events are authored by chapter *number*, not chapter id — that is how a
 * writer thinks about the spine, and it keeps an event placeable on a slot that
 * has not been written yet. The citation is resolved server-side.
 *
 * A row carries the full state after the event, so exactly one subject shape is
 * accepted: a relationship event states type and closeness, a character event
 * states status. The database rejects any other combination.
 */
const relEventSchema = z.object({
  relationshipId: z.uuid(),
  type: z.enum(REL_TYPE_VALUES),
  closeness: z.number().int().min(1).max(10),
});

const charEventSchema = z.object({
  characterId: z.uuid(),
  status: z.enum(CHAR_STATUS_VALUES),
});

const bodySchema = z.intersection(
  z.union([relEventSchema, charEventSchema]),
  z.object({
    chapterNumber: z.number().int().min(0),
    cause: z.string().default(""),
    driverCharacterIds: z.array(z.uuid()).default([]),
    impact: z.enum(EVENT_IMPACT_VALUES).default("major"),
    origin: z.enum(["user", "ai"]).default("user"),
  }),
);

export async function GET(_req: Request, { params }: Params) {
  const { novelId } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(storyEvents)
    .where(eq(storyEvents.novelId, novelId));
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
  const db = getDb();

  const cast = await db
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.novelId, novelId));
  const castIds = new Set(cast.map((c) => c.id));

  // Both subject kinds must belong to this novel — the generic entity routes
  // scope by id alone, so this is the only place that can check it.
  if ("characterId" in body && !castIds.has(body.characterId)) {
    return NextResponse.json(
      { error: "character does not belong to this novel" },
      { status: 400 },
    );
  }
  if ("relationshipId" in body) {
    const [rel] = await db
      .select({ id: relationships.id })
      .from(relationships)
      .where(eq(relationships.id, body.relationshipId));
    if (!rel) {
      return NextResponse.json(
        { error: "relationship not found" },
        { status: 404 },
      );
    }
  }

  const chapterId = await resolveChapterId(novelId, body.chapterNumber);
  const shared = {
    novelId,
    chapterId,
    chapterNumber: body.chapterNumber,
    cause: body.cause,
    driverCharacterIds: body.driverCharacterIds.filter((id) => castIds.has(id)),
    impact: body.impact,
    origin: body.origin,
  };

  const [row] = await db
    .insert(storyEvents)
    .values(
      "relationshipId" in body
        ? {
            ...shared,
            relationshipId: body.relationshipId,
            relType: body.type,
            closeness: body.closeness,
          }
        : {
            ...shared,
            characterId: body.characterId,
            charStatus: body.status,
          },
    )
    .returning();

  return NextResponse.json(row, { status: 201 });
}
