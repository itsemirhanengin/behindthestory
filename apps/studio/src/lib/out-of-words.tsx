"use client";

import Link from "next/link";
import { toast } from "sonner";

/**
 * The one API failure the writer can do something about.
 *
 * Lives in its own module, rather than beside the other error helpers, only so
 * that the toast's action can be a real `<Link>`: this is an internal route,
 * and sending the browser at it with `location.href` throws away the client
 * transition and reloads the whole studio mid-session.
 */

/**
 * Matches on the code rather than on an error class. The streaming endpoints
 * throw a `ProseStreamError` from `@behindthestory/core/prose-stream` while
 * everything else throws an `ApiError`; both carry this code for this reason.
 */
export function isOutOfWords(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "insufficient_words"
  );
}

/**
 * A toast rather than a modal: this fires mid-sentence, and stealing focus
 * from the editor to announce a billing problem is worse than the billing
 * problem. Returns whether it handled the error, so callers can skip their
 * own generic message.
 */
export function notifyIfOutOfWords(error: unknown): boolean {
  if (!isOutOfWords(error)) return false;
  toast.error("You are out of words", {
    description: "Upgrade your plan or buy a top-up to keep writing.",
    action: (
      <Link
        href="/settings/billing"
        className="rounded-md border px-2 py-1 text-xs font-medium"
      >
        Billing
      </Link>
    ),
  });
  return true;
}
