import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * A cheap gate, not the authorisation.
 *
 * This only asks whether a session cookie is present — it never validates it,
 * because proxy code runs ahead of the render and is not meant to reach for the
 * database. Deciding whether the token is real, unexpired and allowed to touch
 * a given novel stays in the route handlers, where the ownership check lives.
 *
 * What this buys is the redirect: a signed-out visitor lands on /sign-in
 * instead of on a page that would render empty and then fail.
 */
const PUBLIC_PATHS = ["/sign-in"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.some((path) => pathname.startsWith(path)) ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  // API callers get a status they can act on; the mobile client will read this
  // the same way once it is pointed here.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const target = new URL("/sign-in", request.url);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and the favicon. Listing exclusions
     * rather than inclusions means a new route is protected by default.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
