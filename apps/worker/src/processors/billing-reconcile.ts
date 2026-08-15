import { eq } from "drizzle-orm";

import { billingSubscriptions, getDb } from "@behindthestory/db";
import { planFor } from "@behindthestory/core/plans";
import { polarProvider, syncWorkspaceFromProvider } from "@behindthestory/core/billing";
import { readBalance } from "@behindthestory/core/word-balance";

/**
 * The safety net under the webhooks.
 *
 * Webhooks are the fast path and they are usually enough. They are also not
 * guaranteed: Polar retries a delivery ten times and then drops it with no
 * further signal, and it disables an endpoint entirely after ten consecutive
 * failures. Either way a workspace can end up on last month's plan with
 * nothing in the logs to say so.
 *
 * So once a night, re-read every workspace that has a subscription and apply
 * whatever the provider currently says. The sync itself is idempotent — a
 * period is granted once, keyed on the subscription and its start — so a run
 * over a workspace nothing has happened to changes nothing.
 */
export async function processBillingReconcile() {
  const db = getDb();
  const subscriptions = await db
    .select({ workspaceId: billingSubscriptions.workspaceId, planSlug: billingSubscriptions.planSlug })
    .from(billingSubscriptions);

  let checked = 0;
  let corrected = 0;

  for (const subscription of subscriptions) {
    checked += 1;
    const before = await readBalance(subscription.workspaceId);
    try {
      const { planSlug } = await syncWorkspaceFromProvider(
        polarProvider,
        subscription.workspaceId,
      );
      if (before && planFor(before.planSlug).slug !== planSlug) {
        corrected += 1;
        console.log(
          `[worker] ${subscription.workspaceId}: ${before.planSlug} -> ${planSlug}`,
        );
      }
    } catch (error) {
      // One unreachable workspace must not stop the sweep.
      console.error(
        `[worker] reconcile failed for ${subscription.workspaceId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(`[worker] reconciled ${checked} subscription(s), ${corrected} corrected`);
  return { checked, corrected };
}

/** Exported for the manual run in `scripts/`. */
export async function forgetSubscription(workspaceId: string) {
  await getDb()
    .delete(billingSubscriptions)
    .where(eq(billingSubscriptions.workspaceId, workspaceId));
}
