import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { desc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";

import {
  getDb,
  novels,
  workspaceMembers,
  POV_VALUES,
  TENSE_VALUES,
} from "@behindthestory/db";

import { assertNovel, requireAuth, type AuthEnv } from "#middleware/auth";
import { primaryWorkspaceId } from "#lib/auth/workspace";

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
});

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

export const novelRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    // Every workspace the caller belongs to, not just their personal one — a
    // Team member should see the shelf they are actually writing on.
    const rows = await getDb()
      .select(getTableColumns(novels))
      .from(novels)
      .innerJoin(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, novels.workspaceId),
      )
      .where(eq(workspaceMembers.userId, c.get("user").id))
      .orderBy(desc(novels.createdAt));
    return c.json(rows);
  })
  .post("/", zValidator("json", createSchema), async (c) => {
    const user = c.get("user");

    // Both ids are set here and never accepted from the client. The workspace
    // is what authorisation and billing key off; the owner is attribution.
    const [row] = await getDb()
      .insert(novels)
      .values({
        ...c.req.valid("json"),
        workspaceId: await primaryWorkspaceId(user.id),
        ownerId: user.id,
      })
      .returning();

    return c.json(row, 201);
  })
  .get("/:novelId", async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);

    const [row] = await getDb()
      .select()
      .from(novels)
      .where(eq(novels.id, novelId));
    return c.json(row);
  })
  .patch("/:novelId", zValidator("json", patchSchema), async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);

    const [row] = await getDb()
      .update(novels)
      .set(c.req.valid("json"))
      .where(eq(novels.id, novelId))
      .returning();
    return c.json(row);
  })
  .delete("/:novelId", async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);

    await getDb().delete(novels).where(eq(novels.id, novelId));
    return c.json({ ok: true });
  });
