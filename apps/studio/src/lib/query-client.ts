import { MutationCache, QueryClient, environmentManager } from "@tanstack/react-query";

import { notifyIfOutOfWords } from "@/lib/out-of-words";

function makeQueryClient() {
  return new QueryClient({
    /**
     * Running out of words is handled once, here, rather than at each of the
     * dozen call sites that can hit it. Every AI action is a mutation, so this
     * is the one place they all pass through — and the recovery is the same
     * wherever it happened.
     */
    mutationCache: new MutationCache({
      onError: (error) => notifyIfOutOfWords(error),
    }),
    defaultOptions: {
      queries: {
        /**
         * A manuscript's cast, places and threads change when the author
         * changes them — not on a timer. Refetching on every window focus made
         * the panels flicker for data that was still correct.
         */
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        /**
         * 401 and 404 are answers, not failures: retrying a signed-out session
         * or someone else's novel just delays the message.
         */
        retry: (failureCount, error) => {
          const status = (error as ApiError).status;
          if (status && status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  // A client created at module scope would be shared by every request on the
  // server, which leaks one reader's manuscript into another's cache.
  if (environmentManager.isServer()) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

/** Carries the status so retry and error handling can reason about it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * Set only where the client has to *do* something rather than just show
     * the message — today that is `insufficient_words`, which opens the
     * upgrade dialog. Matching on the prose of a message instead would break
     * the first time someone reworded it.
     */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Turns a failed response into an `ApiError` with the API's own message.
 * The service always answers `{ error: string }`, so this is the one place
 * that shape is unwrapped.
 */
export async function apiError(res: Response) {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  return new ApiError(
    body.error ?? `Request failed (${res.status})`,
    res.status,
    body.code,
  );
}
