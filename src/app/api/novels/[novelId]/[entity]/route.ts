import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { novelEntityTables, isNovelEntityName } from "@/db/registry";

type Params = { params: Promise<{ novelId: string; entity: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { novelId, entity } = await params;
  if (!isNovelEntityName(entity)) {
    return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  }
  const table = novelEntityTables[entity];
  const db = getDb();
  const rows = await db
    .select()
    .from(table)
    .where(eq(table.novelId, novelId));
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: Params) {
  const { novelId, entity } = await params;
  if (!isNovelEntityName(entity)) {
    return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  }
  const table = novelEntityTables[entity];
  const body = await req.json();
  const db = getDb();
  const values = { ...body, novelId };
  delete values.id;
  delete values.createdAt;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [row] = await db.insert(table).values(values as any).returning();
  return NextResponse.json(row, { status: 201 });
}
