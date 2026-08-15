import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, users, workspaceMembers, workspaces } from "@behindthestory/db";

import { requireAuth, type AuthEnv } from "#middleware/auth";
import {
  assertMember,
  assertWorkspaceAdmin,
  listWorkspacesForUser,
} from "#lib/auth/workspace";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  /**
   * Validated against the model registry at use time rather than here: the
   * registry is the one place that knows which models exist and which plan may
   * reach them, and duplicating that list into a zod enum guarantees it drifts.
   */
  defaultModel: z.string().max(120).nullable().optional(),
});

export const workspaceRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    return c.json(await listWorkspacesForUser(c.get("user").id));
  })
  .get("/:workspaceId/members", async (c) => {
    const workspaceId = c.req.param("workspaceId");
    await assertMember(c.get("user").id, workspaceId);

    const rows = await getDb()
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        email: users.email,
        displayName: users.displayName,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(workspaceMembers.createdAt);

    return c.json(rows);
  })
  .patch("/:workspaceId", zValidator("json", patchSchema), async (c) => {
    const workspaceId = c.req.param("workspaceId");
    await assertWorkspaceAdmin(c.get("user").id, workspaceId);

    const [row] = await getDb()
      .update(workspaces)
      .set(c.req.valid("json"))
      .where(eq(workspaces.id, workspaceId))
      .returning();

    return c.json(row);
  });
