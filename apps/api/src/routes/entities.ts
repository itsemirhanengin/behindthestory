import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";

import { getDb } from "@behindthestory/db";
import { entityTables, isEntityName } from "@behindthestory/db/registry";

import {
  assertChapter,
  assertNovel,
  requireAuth,
  type AuthEnv,
} from "#middleware/auth";

/**
 * Resolves `:entity/:id` to a row the caller owns.
 *
 * Authorisation still reduces to one edge, but these tables reach it two ways:
 * revisions hang off a chapter, everything else off a novel directly. The cast
 * is safe because the branch is chosen by the entity name, and the registry is
 * where that split is defined.
 *
 * An unknown entity name and someone else's row both come back as 404 — the
 * caller learns nothing either way.
 */
async function loadOwned(userId: string, entity: string, id: string) {
  if (!isEntityName(entity)) {
    throw new HTTPException(404, { message: "Unknown entity" });
  }
  const table = entityTables[entity];
  const [row] = await getDb().select().from(table).where(eq(table.id, id));
  if (!row) throw new HTTPException(404, { message: "Not found" });

  if (entity === "chapter-revisions") {
    await assertChapter(userId, (row as { chapterId: string }).chapterId);
  } else {
    await assertNovel(userId, (row as { novelId: string }).novelId);
  }

  return { table, row };
}

export const entityRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/:entity/:id", async (c) => {
    const { row } = await loadOwned(
      c.get("user").id,
      c.req.param("entity"),
      c.req.param("id"),
    );
    return c.json(row);
  })
  /* A free-form record by design: the shape is whatever the chosen table
     accepts, and the registry is where that mapping lives. Declaring it here
     anyway is what lets the RPC client send a typed body at all. */
  .patch("/:entity/:id", zValidator("json", z.record(z.string(), z.unknown())), async (c) => {
    const id = c.req.param("id");
    const { table } = await loadOwned(
      c.get("user").id,
      c.req.param("entity"),
      id,
    );

    const body = { ...c.req.valid("json") };
    // Identity and parentage are not editable: letting `novelId` through would
    // let a caller move a row into a novel they own and read it back.
    delete body.id;
    delete body.novelId;
    delete body.createdAt;

    const [updated] = await getDb()
      .update(table)
      .set(body)
      .where(eq(table.id, id))
      .returning();
    return c.json(updated);
  })
  .delete("/:entity/:id", async (c) => {
    const id = c.req.param("id");
    const { table } = await loadOwned(
      c.get("user").id,
      c.req.param("entity"),
      id,
    );

    await getDb().delete(table).where(eq(table.id, id));
    return c.json({ ok: true });
  });
