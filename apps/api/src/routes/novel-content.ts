import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { aiGenerations, chapters, getDb, novels } from "@behindthestory/db";
import {
  isNovelEntityName,
  novelEntityTables,
} from "@behindthestory/db/registry";
import { activeSpine } from "@behindthestory/core/context-builder";

import { assertNovel, requireAuth, type AuthEnv } from "#middleware/auth";

function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "novel"
  );
}

/**
 * Everything hanging off a novel.
 *
 * Static paths are registered before the generic `/:novelId/:entity` so the
 * catch-all cannot swallow them — Hono would prefer the static segment anyway,
 * but relying on that makes the order look arbitrary to the next reader.
 */
export const novelContentRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  /** Aggregate AI spend for this novel, so generation cost is not invisible. */
  .get("/:novelId/usage", async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);
    const db = getDb();

    const [totals] = await db
      .select({
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiGenerations.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiGenerations.outputTokens}), 0)::int`,
      })
      .from(aiGenerations)
      .where(eq(aiGenerations.novelId, novelId));

    const byRoute = await db
      .select({
        route: aiGenerations.route,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiGenerations.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiGenerations.outputTokens}), 0)::int`,
      })
      .from(aiGenerations)
      .where(eq(aiGenerations.novelId, novelId))
      .groupBy(aiGenerations.route)
      .orderBy(desc(sql`count(*)`));

    return c.json({ totals, byRoute });
  })
  /**
   * Exports the manuscript as a single Markdown file. Chapters are stored as
   * Markdown already, so this is a concatenation rather than a conversion.
   */
  .get("/:novelId/export", async (c) => {
    const novelId = c.req.param("novelId");
    await assertNovel(c.get("user").id, novelId);
    const includeDrafts = c.req.query("drafts") !== "false";

    const db = getDb();
    const [novel] = await db.select().from(novels).where(eq(novels.id, novelId));
    const rows = await db
      .select()
      .from(chapters)
      .where(eq(chapters.novelId, novelId));

    // Only the active variant of each slot is part of the manuscript.
    const included = activeSpine(rows).filter(
      (ch) => ch.content.trim() && (includeDrafts || ch.status === "final"),
    );

    const body = included
      .map(
        (ch) =>
          `## Chapter ${ch.number}\n\n### ${ch.title}\n\n${ch.content.trim()}`,
      )
      .join("\n\n---\n\n");

    const markdown = [
      `# ${novel.title}`,
      novel.premise ? `> ${novel.premise}` : "",
      included.length ? body : "_No written chapters yet._",
    ]
      .filter(Boolean)
      .join("\n\n");

    return c.body(markdown, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(novel.title)}.md"`,
    });
  })
  /**
   * Creates a chapter with a server-assigned slot. The number is never computed
   * on the client: two quick clicks used to produce two chapters claiming the
   * same position, which is exactly how the duplicate "Chapter 2" appeared.
   */
  .post(
    "/:novelId/add-chapter",
    zValidator(
      "json",
      z.object({
        /** Insert directly after this slot. Omit to append to the end. */
        afterNumber: z.number().int().positive().optional(),
        title: z.string().max(300).optional(),
      }),
    ),
    async (c) => {
      const novelId = c.req.param("novelId");
      await assertNovel(c.get("user").id, novelId);
      const { afterNumber, title } = c.req.valid("json");

      const db = getDb();
      const existing = await db
        .select({ number: chapters.number, act: chapters.act })
        .from(chapters)
        .where(eq(chapters.novelId, novelId));

      const lastNumber = existing.reduce((max, ch) => Math.max(max, ch.number), 0);
      let slot = lastNumber + 1;

      if (afterNumber !== undefined && afterNumber < lastNumber) {
        slot = afterNumber + 1;
        // Park in the negative range so the shift never passes through a taken
        // slot, which the unique index would reject.
        await db
          .update(chapters)
          .set({ number: sql`-(${chapters.number} + 1)` })
          .where(
            and(eq(chapters.novelId, novelId), gt(chapters.number, afterNumber)),
          );
        await db
          .update(chapters)
          .set({ number: sql`-${chapters.number}` })
          .where(sql`${chapters.novelId} = ${novelId} and ${chapters.number} < 0`);
      }

      // A new chapter belongs to whatever act it lands in.
      const act =
        existing
          .filter((ch) => ch.number < slot)
          .sort((a, b) => b.number - a.number)[0]?.act ?? 1;

      const [created] = await db
        .insert(chapters)
        .values({ novelId, number: slot, act, title: title ?? `Chapter ${slot}` })
        .returning();

      return c.json(created, 201);
    },
  )
  /**
   * Renumbers the spine. All variants of a slot move together, since a slot is
   * one position in reading order regardless of how many drafts it holds.
   *
   * Numbers are parked in the negative range first: the unique index on
   * (novel_id, number) would otherwise reject any reorder that passes through a
   * position another chapter still occupies.
   */
  .post(
    "/:novelId/reorder-chapters",
    zValidator(
      "json",
      z.object({
        /** Current slot numbers, in the order they should now read. */
        order: z.array(z.number().int().positive()).min(1),
      }),
    ),
    async (c) => {
      const novelId = c.req.param("novelId");
      await assertNovel(c.get("user").id, novelId);
      const { order } = c.req.valid("json");

      const db = getDb();
      const existing = await db
        .select({ number: chapters.number })
        .from(chapters)
        .where(eq(chapters.novelId, novelId));

      const slots = [...new Set(existing.map((ch) => ch.number))].sort(
        (a, b) => a - b,
      );
      const requested = [...new Set(order)];
      if (
        requested.length !== slots.length ||
        !requested.every((n) => slots.includes(n))
      ) {
        return c.json(
          { error: "The order must list every existing chapter slot exactly once." },
          400,
        );
      }

      const mapping = new Map(requested.map((oldNumber, i) => [oldNumber, i + 1]));
      if ([...mapping].every(([from, to]) => from === to)) {
        return c.json({ ok: true, moved: 0 });
      }

      const cases = sql.join(
        [...mapping].map(
          ([from, to]) => sql`when ${chapters.number} = ${from} then ${-to}`,
        ),
        sql` `,
      );

      await db
        .update(chapters)
        .set({ number: sql`case ${cases} else ${chapters.number} end` })
        .where(eq(chapters.novelId, novelId));

      await db
        .update(chapters)
        .set({ number: sql`-${chapters.number}` })
        .where(sql`${chapters.novelId} = ${novelId} and ${chapters.number} < 0`);

      return c.json({ ok: true, moved: mapping.size });
    },
  )
  /* --- Generic list/create, registered last so it cannot shadow the above. --- */
  .get("/:novelId/:entity", async (c) => {
    const novelId = c.req.param("novelId");
    const entity = c.req.param("entity");
    await assertNovel(c.get("user").id, novelId);
    if (!isNovelEntityName(entity)) {
      throw new HTTPException(404, { message: "Unknown entity" });
    }

    const table = novelEntityTables[entity];
    const rows = await getDb().select().from(table).where(eq(table.novelId, novelId));
    return c.json(rows);
  })
  .post("/:novelId/:entity", async (c) => {
    const novelId = c.req.param("novelId");
    const entity = c.req.param("entity");
    await assertNovel(c.get("user").id, novelId);
    if (!isNovelEntityName(entity)) {
      throw new HTTPException(404, { message: "Unknown entity" });
    }

    const table = novelEntityTables[entity];
    const body = (await c.req.json()) as Record<string, unknown>;
    // The novel comes from the authorised path parameter, never from the body.
    const values: Record<string, unknown> = { ...body, novelId };
    delete values.id;
    delete values.createdAt;

    const [row] = await getDb()
      .insert(table)
      // The registry is a union of tables, so a single insert cannot be typed
      // across all of them; the values are shaped by the caller's chosen entity.
      .values(values as never)
      .returning();
    return c.json(row, 201);
  });
