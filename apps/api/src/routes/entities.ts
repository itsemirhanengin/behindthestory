import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { and, eq, sql } from "drizzle-orm";

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

/**
 * The reserved body key a caller uses to say which version of the row it edited.
 *
 * It rides in the body rather than an `If-Match` header because this route
 * already reserves keys — `id`, `novelId` and `createdAt` are stripped for
 * safety — and because the RPC client types a JSON body, not headers.
 */
const EXPECTED = "expectedUpdatedAt";

type Versioned = { updatedAt: Date };

/** `chapter-revisions` are append-only snapshots and carry no version. */
function versionColumn(table: unknown) {
  return (table as { updatedAt?: unknown }).updatedAt;
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
    const { table, row } = await loadOwned(
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

    const expectedRaw = body[EXPECTED];
    delete body[EXPECTED];
    // `updatedAt` is stamped by the column's `$onUpdate`; accepting one from the
    // caller would let a client freeze its own version and never conflict again.
    delete body.updatedAt;

    const version = versionColumn(table);
    let expected: Date | null = null;

    if (expectedRaw !== undefined && expectedRaw !== null) {
      if (!version) {
        return c.json(
          { error: `${c.req.param("entity")} rows are not versioned.` },
          400,
        );
      }
      const parsed = new Date(String(expectedRaw));
      if (Number.isNaN(parsed.getTime())) {
        return c.json({ error: `${EXPECTED} is not a valid timestamp.` }, 400);
      }
      expected = parsed;
    }

    const [updated] = await getDb()
      .update(table)
      .set(body)
      .where(
        expected
          ? // Compared at millisecond grain on BOTH sides: rows stamped by
            // Postgres `now()` (the insert default) carry microseconds, while a
            // JavaScript Date — which is what every client echoes back — can
            // only ever say milliseconds. Raw equality therefore failed on any
            // row that had never been updated from JS, which made the very
            // first versioned save of a fresh row a guaranteed 409.
            and(
              eq(table.id, id),
              sql`date_trunc('milliseconds', ${version as never}) = date_trunc('milliseconds', ${expected})`,
            )
          : eq(table.id, id),
      )
      .returning();

    /**
     * No row came back, and `loadOwned` already proved the row exists and is
     * the caller's — so the version is what did not match. Someone else wrote
     * to it since this caller last read it.
     *
     * The current row is returned with the 409 so the client can resolve the
     * conflict without a second round trip. For prose that means keeping the
     * local copy as a revision and adopting this one.
     */
    if (!updated) {
      // Re-read rather than reuse the row from `loadOwned`: another write can
      // land between that select and this update, and a conflict response that
      // hands back a stale row would send the client into a second conflict.
      const [current] = await getDb().select().from(table).where(eq(table.id, id));
      return c.json(
        {
          error: "This has changed since you last loaded it.",
          expected: expected?.toISOString() ?? null,
          actual: (current as Versioned | undefined)?.updatedAt?.toISOString() ?? null,
          current: current ?? row,
        },
        409,
      );
    }

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
