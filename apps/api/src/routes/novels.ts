import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  getDb,
  novels,
  POV_VALUES,
  TENSE_VALUES,
} from "@behindthestory/db";
import { logGeneration } from "@behindthestory/ai";

import { assertNovel, requireAuth, type AuthEnv } from "#middleware/auth";

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
    const rows = await getDb()
      .select()
      .from(novels)
      .where(eq(novels.ownerId, c.get("user").id))
      .orderBy(desc(novels.createdAt));
    return c.json(rows);
  })
  .post("/", zValidator("json", createSchema), async (c) => {
    const { aiUsage, ...values } = c.req.valid("json");

    // Ownership is set here and never accepted from the client — it is the only
    // thing standing between two accounts' manuscripts.
    const [row] = await getDb()
      .insert(novels)
      .values({ ...values, ownerId: c.get("user").id })
      .returning();

    for (const entry of aiUsage) {
      await logGeneration({ novelId: row.id, ...entry });
    }

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
