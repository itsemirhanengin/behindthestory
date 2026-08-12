import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, novels } from "@/db";

export async function GET() {
  const db = getDb();
  const rows = await db.select().from(novels).orderBy(desc(novels.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const db = getDb();
  const [row] = await db
    .insert(novels)
    .values({ title: body.title, premise: body.premise ?? "" })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
