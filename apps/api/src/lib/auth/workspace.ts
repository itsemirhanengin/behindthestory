import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import {
  getDb,
  novels,
  workspaceMembers,
  workspaces,
  type WORKSPACE_ROLE_VALUES,
} from "@behindthestory/db";

export type WorkspaceRole = (typeof WORKSPACE_ROLE_VALUES)[number];

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything you can run a query on — the pool, or an open transaction. */
export type DbLike = Db | Tx;

/** Roles that may spend money or change who is in the workspace. */
const ADMIN_ROLES: readonly WorkspaceRole[] = ["owner", "admin"];

function slugify(input: string) {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "workspace";
}

/**
 * Creates the workspace a new account writes in, plus its owner membership.
 *
 * Called from inside the sign-in transaction, so a first sign-in can never
 * produce an account with nowhere to put a novel. The slug carries random
 * suffix rather than a uniqueness retry loop: two people signing up as
 * `ada@…` at the same moment would otherwise race on the same candidate.
 */
export async function provisionPersonalWorkspace(
  tx: DbLike,
  user: { id: string; email: string; displayName: string },
) {
  const label = user.displayName || user.email.split("@")[0] || "My workspace";
  const slug = `${slugify(label)}-${randomBytes(3).toString("hex")}`;

  const [workspace] = await tx
    .insert(workspaces)
    .values({ name: label, slug })
    .returning();

  await tx.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: "owner",
  });

  return workspace;
}

/** The caller's role in a workspace, or null when they are not a member. */
export async function roleInWorkspace(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await getDb()
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    );
  return row?.role ?? null;
}

/**
 * 404 rather than 403, for the same reason `ownership.ts` does it: a 403
 * confirms the workspace exists, which turns the id space into a directory.
 */
export async function assertMember(userId: string, workspaceId: string) {
  const role = await roleInWorkspace(userId, workspaceId);
  if (!role) throw new HTTPException(404, { message: "Not found" });
  return role;
}

/**
 * Membership is already proven by the time this rejects, so the existence of
 * the workspace is no longer a secret — 403 is the honest answer.
 */
export async function assertWorkspaceAdmin(userId: string, workspaceId: string) {
  const role = await assertMember(userId, workspaceId);
  if (!ADMIN_ROLES.includes(role)) {
    throw new HTTPException(403, {
      message: "Only workspace owners and admins can do that",
    });
  }
  return role;
}

export async function listWorkspacesForUser(userId: string) {
  return getDb()
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      defaultModel: workspaces.defaultModel,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);
}

/**
 * The workspace a novel belongs to. Returns null for a novel that predates the
 * backfill; callers treat that the same as "not found".
 */
export async function workspaceIdForNovel(novelId: string) {
  const [row] = await getDb()
    .select({ workspaceId: novels.workspaceId })
    .from(novels)
    .where(eq(novels.id, novelId));
  return row?.workspaceId ?? null;
}

/**
 * Where a novel goes when the caller did not say. Their oldest workspace is
 * the personal one created at sign-in, which is the right default until the
 * product grows a workspace switcher.
 */
export async function primaryWorkspaceId(userId: string) {
  const [row] = await getDb()
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaceMembers.createdAt)
    .limit(1);

  if (!row) {
    // Only reachable for an account created before workspaces existed and
    // never backfilled. Failing loudly beats writing a novel nobody can read.
    throw new HTTPException(409, {
      message: "This account has no workspace. Run the workspace backfill.",
    });
  }
  return row.id;
}
