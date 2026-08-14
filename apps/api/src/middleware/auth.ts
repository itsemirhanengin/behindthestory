import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import {
  SESSION_COOKIE,
  resolveSession,
  type AuthenticatedUser,
} from "#lib/auth/session";
import { ownsChapter, ownsNovel } from "#lib/auth/ownership";

export type AuthEnv = {
  Variables: {
    user: AuthenticatedUser;
  };
};

/**
 * Resolves the session once per request and puts the account on the context.
 *
 * Both clients hand over the same token through different doors — the web app
 * in an httpOnly cookie, the mobile app as a bearer header out of secure
 * storage — and everything downstream sees one shape.
 */
export function sessionToken(c: Context) {
  const header = c.req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return getCookie(c, SESSION_COOKIE) ?? null;
}

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const user = await resolveSession(sessionToken(c));
  if (!user) throw new HTTPException(401, { message: "Unauthorized" });

  c.set("user", user);
  await next();
});

/**
 * Ownership, entered from whichever id the route happens to carry.
 *
 * 404 rather than 403 on purpose: a 403 confirms the id exists, which lets
 * someone enumerate other writers' novels one uuid at a time.
 */
export async function assertNovel(userId: string, novelId: string) {
  if (!(await ownsNovel(userId, novelId))) {
    throw new HTTPException(404, { message: "Not found" });
  }
}

export async function assertChapter(userId: string, chapterId: string) {
  if (!(await ownsChapter(userId, chapterId))) {
    throw new HTTPException(404, { message: "Not found" });
  }
}
