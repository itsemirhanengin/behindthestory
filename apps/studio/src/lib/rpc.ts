import { hc } from "hono/client";
import type { AppType } from "@behindthestory/api/type";

/**
 * The typed client. Paths, request bodies and response shapes are all inferred
 * from the server's route definitions, so a change on either side becomes a
 * compile error here rather than a runtime surprise.
 *
 * Relative base URL on purpose: the browser only ever talks to this origin and
 * Next forwards `/api/*` to the service, which is what keeps the session cookie
 * first-party.
 */
export const rpc = hc<AppType>("/");
