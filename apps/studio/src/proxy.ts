import { NextResponse, type NextRequest } from "next/server";

/**
 * The studio is signed-in territory end to end, so the gate belongs here
 * rather than in each page. Without it a signed-out visitor got the whole
 * shell — rail, header, "New novel" — wrapped around an "Unauthorized" panel,
 * which reads as a broken app rather than as a closed door.
 *
 * Optimistic on purpose: this only asks whether a session cookie is present,
 * never whether the API still honours it. Proxy runs on every request,
 * prefetches included, and a round trip to the API on each one would cost far
 * more than it buys. A cookie the API has since revoked gets through to the
 * page and is caught there by the 401 handler in `lib/query-client.ts`.
 */

/** Mirrors `SESSION_COOKIE` in the API service. Named here rather than
 *  imported because proxy code is deployed apart from the app. */
const SESSION_COOKIE = "bts_session";
const SIGN_IN = "/sign-in";

/** Kept in step with `REQUESTED_PATH` in `lib/session.ts`. */
const REQUESTED_PATH = "x-requested-path";

/** Only a path on this origin. Anything else in `?next=` — an absolute URL, a
 *  protocol-relative `//host` — would turn sign-in into an open redirect. */
function internalPath(value: string | undefined) {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const atSignIn = pathname === SIGN_IN;

  if (!signedIn && !atSignIn) {
    const url = request.nextUrl.clone();
    url.pathname = SIGN_IN;
    url.search = "";
    // Where they were headed, so signing in resumes that chapter instead of
    // dropping them on the shelf to find it again.
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  /* `?expired` is the app telling this gate that the cookie it just trusted is
     no longer honoured by the API. Without that word the two would argue: the
     app sends the writer here, the cookie sends them back. */
  if (signedIn && atSignIn && !request.nextUrl.searchParams.has("expired")) {
    const next =
      internalPath(request.nextUrl.searchParams.get("next") ?? undefined) ?? "/";
    return NextResponse.redirect(new URL(next, request.url));
  }

  /* Server components have no way to ask what URL they are rendering, and
     `requireSession` needs it to say where to come back to. */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUESTED_PATH, `${pathname}${search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  /* Everything but the API proxy, the build output and static assets. `/api/*`
     especially: those are rewritten to the API service, which answers a
     signed-out caller itself. */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
