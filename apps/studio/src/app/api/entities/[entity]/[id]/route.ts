import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@behindthestory/db";
import { entityTables, isEntityName } from "@behindthestory/db/registry";

type Params = { params: Promise<{ entity: string; id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!isEntityName(entity)) {
    return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  }
  const table = entityTables[entity];
  const db = getDb();
  const [row] = await db.select().from(table).where(eq(table.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!isEntityName(entity)) {
    return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  }
  const table = entityTables[entity];
  const body = await req.json();
  delete body.id;
  delete body.novelId;
  delete body.createdAt;
  const db = getDb();
  const [row] = await db
    .update(table)
    .set(body)
    .where(eq(table.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!isEntityName(entity)) {
    return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  }
  const table = entityTables[entity];
  const db = getDb();
  await db.delete(table).where(eq(table.id, id));
  return NextResponse.json({ ok: true });
}
