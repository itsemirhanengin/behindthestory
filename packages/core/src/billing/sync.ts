import { eq } from "drizzle-orm";

import {
  billingSubscriptions,
  billingWebhookEvents,
  getDb,
  workspaceBalances,
} from "@behindthestory/db";
import { TOPUP_PACKS, type PlanSlug } from "../plans";
import {
  ensureBalance,
  grantPlanWords,
  grantTopupWords,
  periodEndFrom,
} from "../word-balance";

import { resolveProduct } from "./products";
import type { BillingProvider, ProviderEvent } from "./provider";

/**
 * Turning what the provider says into what the workspace can spend.
 *
 * Written to be order-independent and repeat-safe, because Polar guarantees
 * neither: deliveries can arrive out of order, and an event can be retried up
 * to ten times. Nothing here trusts the payload's contents beyond the customer
 * id — the current state is re-fetched and applied wholesale, so an event that
 * arrives late cannot undo a newer one it knows nothing about.
 */

/**
 * Records the delivery and reports whether this is the first sight of it.
 *
 * Keyed on the `webhook-id` header, which is stable across retries.
 */
export async function claimWebhookDelivery(
  id: string,
  type: string,
  provider = "polar",
): Promise<boolean> {
  const [row] = await getDb()
    .insert(billingWebhookEvents)
    .values({ id, provider, type })
    .onConflictDoNothing({ target: billingWebhookEvents.id })
    .returning({ id: billingWebhookEvents.id });
  return Boolean(row);
}

/**
 * Brings a workspace's plan and allowance in line with the provider.
 *
 * Granting is keyed on the subscription and its period start, so a redelivered
 * event — or the daily reconcile running over a workspace nothing has happened
 * to — cannot hand out a second month.
 */
export async function syncWorkspaceFromProvider(
  provider: BillingProvider,
  workspaceId: string,
): Promise<{ planSlug: PlanSlug }> {
  const db = getDb();
  const state = await provider.getCustomerState(workspaceId);
  await ensureBalance(workspaceId);

  const subscription = state?.subscription;
  const entitled = subscription?.entitled ? subscription : null;
  const planSlug: PlanSlug = entitled?.planSlug ?? "free";

  if (entitled) {
    await db
      .insert(billingSubscriptions)
      .values({
        workspaceId,
        provider: provider.name,
        providerSubscriptionId: entitled.id,
        providerProductId: entitled.productId,
        planSlug,
        status: entitled.status,
        currentPeriodStart: entitled.currentPeriodStart,
        currentPeriodEnd: entitled.currentPeriodEnd,
        cancelAtPeriodEnd: entitled.cancelAtPeriodEnd,
      })
      .onConflictDoUpdate({
        target: billingSubscriptions.workspaceId,
        set: {
          providerSubscriptionId: entitled.id,
          providerProductId: entitled.productId,
          planSlug,
          status: entitled.status,
          currentPeriodStart: entitled.currentPeriodStart,
          currentPeriodEnd: entitled.currentPeriodEnd,
          cancelAtPeriodEnd: entitled.cancelAtPeriodEnd,
        },
      });

    const periodStart = entitled.currentPeriodStart ?? new Date();
    await grantPlanWords({
      workspaceId,
      planSlug,
      // The period, not the event, is the unit of granting.
      requestId: `plan:${entitled.id}:${periodStart.toISOString()}`,
      periodStart,
      periodEnd: entitled.currentPeriodEnd ?? periodEndFrom(periodStart),
      note: `${planSlug} period`,
    });
  } else {
    await db
      .delete(billingSubscriptions)
      .where(eq(billingSubscriptions.workspaceId, workspaceId));

    /**
     * Dropping to Free does not claw back the words already granted for the
     * period that was paid for — that would be taking back something bought.
     * Only the plan label changes; the next period grants Free's allowance.
     */
    await db
      .update(workspaceBalances)
      .set({ planSlug: "free" })
      .where(eq(workspaceBalances.workspaceId, workspaceId));
  }

  return { planSlug };
}

/** Credits a one-off pack. Idempotent on the provider's order id. */
export async function applyTopupOrder(input: {
  workspaceId: string;
  orderId: string;
  productId: string;
}): Promise<boolean> {
  const resolved = resolveProduct(input.productId);
  if (resolved?.type !== "topup") return false;

  await ensureBalance(input.workspaceId);
  await grantTopupWords({
    workspaceId: input.workspaceId,
    words: TOPUP_PACKS[resolved.pack].words,
    requestId: `polar_order:${input.orderId}`,
    note: TOPUP_PACKS[resolved.pack].label,
  });
  return true;
}

/** Applies one already-verified event. */
export async function applyProviderEvent(
  provider: BillingProvider,
  event: ProviderEvent,
): Promise<void> {
  switch (event.kind) {
    case "state_changed":
    case "subscription_ended":
      if (event.externalId) {
        await syncWorkspaceFromProvider(provider, event.externalId);
      }
      return;

    case "order_paid":
      if (!event.externalId) return;
      // A subscription order is a renewal; the state sync grants for it. Only
      // a top-up needs crediting from the order itself.
      if (
        !(await applyTopupOrder({
          workspaceId: event.externalId,
          orderId: event.orderId,
          productId: event.productId,
        }))
      ) {
        await syncWorkspaceFromProvider(provider, event.externalId);
      }
      return;

    case "ignored":
      return;
  }
}
