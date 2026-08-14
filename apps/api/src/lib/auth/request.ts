import { cookies } from "next/headers";

import {
  SESSION_COOKIE,
  resolveSession,
  type AuthenticatedUser,
} from "@/lib/auth/session";

/**
 * Both clients hand us the same token, just through different doors: the web
 * app has it in an httpOnly cookie, the mobile app sends it as a bearer header
 * from secure storage. Everything downstream sees one shape.
 */
export async function tokenFromRequest(request: Request) {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();

  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function currentUser(
  request: Request,
): Promise<AuthenticatedUser | null> {
  return resolveSession(await tokenFromRequest(request));
}

/**
 * Returned, never thrown. Next does not catch a `Response` thrown out of a
 * route handler the way Remix does — it becomes a 500 — so guards hand back a
 * response the handler returns itself.
 */
export function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The client's address, read from the proxy header Railway sets. Only used for
 * rate-limit bucketing and the device list, never for authorisation — it is
 * caller-influenced and must not gate access.
 */
export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
