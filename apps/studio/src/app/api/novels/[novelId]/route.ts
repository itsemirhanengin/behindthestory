import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, novels, POV_VALUES, TENSE_VALUES } from "@/db";
import { currentUser, unauthorized } from "@/lib/auth/request";
import { notFound, ownsNovel } from "@/lib/auth/ownership";

type Params = { params: Promise<{ novelId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { novelId } = await params;
  const user = await currentUser(req);
  if (!user) return unauthorized();
  if (!(await ownsNovel(user.id, novelId))) return notFound();
  const db = getDb();
  const [row] = await db.select().from(novels).where(eq(novels.id, novelId));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  premise: z.string().max(20_000).optional(),
  genre: z.string().max(200).optional(),
  tone: z.string().max(500).optional(),
  pov: z.enum(POV_VALUES).optional(),
  tense: z.enum(TENSE_VALUES).optional(),
  targetChapterWords: z.number().int().min(200).max(20_000).optional(),
  styleNotes: z.string().max(20_000).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  const { novelId } = await params;
  const user = await currentUser(req);
  if (!user) return unauthorized();
  if (!(await ownsNovel(user.id, novelId))) return notFound();
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid request: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    );
  }
  const db = getDb();
  const [row] = await db
    .update(novels)
    .set(parsed.data)
    .where(eq(novels.id, novelId))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(req: Request, { params }: Params) {
  const { novelId } = await params;
  const user = await currentUser(req);
  if (!user) return unauthorized();
  if (!(await ownsNovel(user.id, novelId))) return notFound();
  const db = getDb();
  await db.delete(novels).where(eq(novels.id, novelId));
  return NextResponse.json({ ok: true });
}
