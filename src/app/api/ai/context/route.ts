import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSceneContext } from "@/lib/scene-context";

export const maxDuration = 120;

const bodySchema = z.object({
  novelId: z.uuid(),
  chapterId: z.uuid().optional(),
  selectedCharacterIds: z.array(z.uuid()).default([]),
  selectedLocationIds: z.array(z.uuid()).default([]),
  selectedElementIds: z.array(z.uuid()).default([]),
  instruction: z.string().max(4000).optional(),
  draftTail: z.string().max(8000).optional(),
});

/**
 * Returns exactly what the model would be shown for the current selection.
 * The point is that "what does the AI actually know?" stops being a guess.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { context, retrievedCount } = await buildSceneContext(parsed.data);
  return NextResponse.json({ ...context, retrievedCount });
}
