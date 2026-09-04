import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * The signed-in check that actually decides, asked of the API before a single
 * byte of the page is sent.
 *
 * `proxy.ts` can only see whether a cookie is present, and the client-side
 * gate can only act once the page has hydrated — which is exactly the moment a
 * dead session used to be discovered, leaving a shelf full of skeletons for
 * anyone whose bundle was slow to arrive. Answering here turns that into the
 * same plain redirect a missing cookie gets.
 *
 * The cost is one request to a service already on this network, on a page that
 * was never static: every route that calls this reads a cookie anyway.
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";

/** Set by `proxy.ts`, which is the only place that knows the requested URL. */
const REQUESTED_PATH = "x-requested-path";

/** Whether the caller is signed in is the whole question here; who they are is
 *  the client's business, which asks the same endpoint through `useSession`. */
export async function requireSession(): Promise<void> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  const response = await fetch(`${API_URL}/api/auth/session`, {
    headers: { cookie: cookieStore.toString() },
    // Whose session this is cannot be shared between requests.
    cache: "no-store",
  }).catch(() => null);

  const session = response?.ok
    ? ((await response.json()) as { user: { id: string } | null })
    : null;

  if (session?.user) return;

  /* A service that is down is not a signed-out writer, but there is nothing
     useful to render either way, and the sign-in form is at least a page that
     works. */
  const requested = headerStore.get(REQUESTED_PATH);
  const next =
    requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  redirect(`/sign-in?expired=1&next=${encodeURIComponent(next)}`);
}
