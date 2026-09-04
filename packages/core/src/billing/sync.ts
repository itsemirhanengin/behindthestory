import { and, eq } from "drizzle-orm";

import {
  billingRefunds,
  billingSubscriptions,
  billingWebhookEvents,
  getDb,
  workspaceBalances,
} from "@behindthestory/db";
import {
  FREE_PLAN,
  PLANS,
  TOPUP_PACKS,
  planChangeDirection,
  planFor,
  type PaidPlanSlug,
  type PlanSlug,
} from "../plans";
import {
  clampPlanWords,
  clawbackTopupWords,
  ensureBalance,
  grantPlanUpgradeWords,
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
  const stored = await ensureBalance(workspaceId);

  const subscription = state?.subscription;
  const entitled = subscription?.entitled ? subscription : null;
  const planSlug: PlanSlug = entitled?.planSlug ?? "free";

  if (entitled) {
    /* Only when the provider actually told us. `undefined` means the read
       failed, and overwriting a real scheduled downgrade with "nothing" on the
       strength of a failed read is the one mistake here that loses
       information. */
    const scheduled =
      entitled.pendingPlanSlug === undefined
        ? {}
        : {
            pendingPlanSlug: entitled.pendingPlanSlug,
            pendingPlanAt: entitled.pendingPlanAt ?? null,
          };

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
        ...scheduled,
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
          ...scheduled,
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

    /**
     * The label, and then — separately — the words.
     *
     * These have to be two statements, because they answer to different
     * rules. Which plan a workspace is on is derived state: it is whatever the
     * provider currently says, it can be written as often as we like, and the
     * balance row is what decides the model picker and the rate limit, so it
     * being stale is a live wrong answer. Granting words is a movement, and a
     * movement must happen once.
     *
     * Coupling them is the mistake this replaced. `grantPlanWords` above is
     * keyed on the period, so inside one period it rolls back and writes
     * nothing at all — including the label. A plan changed mid-period in the
     * provider's own portal, which our "Manage subscription" button links to,
     * therefore left the balance claiming the old plan indefinitely.
     */
    if (stored.planSlug !== planSlug) {
      await db
        .update(workspaceBalances)
        .set({ planSlug })
        .where(eq(workspaceBalances.workspaceId, workspaceId));

      /* Only upwards, and only once per period per destination. A plan that
         lowered the allowance takes nothing back: words already granted for a
         period that was paid for are not reclaimed. */
      if (PLANS[planSlug].monthlyWords > PLANS[stored.planSlug].monthlyWords) {
        await grantPlanUpgradeWords({
          workspaceId,
          fromPlan: stored.planSlug,
          toPlan: planSlug,
          requestId: `plan-change:${entitled.id}:${periodStart.toISOString()}:${planSlug}`,
          note: `${stored.planSlug} → ${planSlug}`,
        });
      }
    }
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

/**
 * Raised when a plan change is asked for on a workspace that has no
 * subscription to change. Its own class because the answer is not an error
 * message but a different route: that workspace has to check out.
 */
export class NoSubscriptionError extends Error {
  constructor() {
    super("This workspace has no subscription to change.");
    this.name = "NoSubscriptionError";
  }
}

export type PlanChangeOutcome = {
  /** The plan the workspace is on right now. */
  planSlug: PlanSlug;
  /** A change that has been scheduled but has not happened yet. */
  pendingPlanSlug: PlanSlug | null;
  /** When the requested plan starts — now, for an upgrade. */
  effectiveAt: Date | null;
  direction: "upgrade" | "downgrade" | "same";
};

/**
 * Moving a live subscription between plans.
 *
 * The rule, and the reason for it:
 *
 * **Upgrades apply now.** Somebody paying more wants what they paid for in the
 * sentence they are writing, not next month. The unused remainder of the old
 * plan is credited against the new charge, so one net movement appears on the
 * card, and the allowance difference is added to the balance on the spot.
 *
 * **Downgrades apply at the renewal.** The current period is already paid for
 * at the higher price; taking the plan away mid-period while keeping the money
 * is the one combination nobody would call fair. Nothing is charged, nothing
 * is refunded, and the higher plan's rights stand until the date the writer
 * was already going to be billed on. It also happens to be free to implement:
 * the renewal grants the new plan's allowance through the path that already
 * runs every month.
 *
 * This is not `createCheckout`. Checking out again while a subscription is
 * live opens a *second* one, and Polar bills both while our reading of the
 * customer state — newest period wins — quietly reports only one.
 */
export async function changeWorkspacePlan(
  provider: BillingProvider,
  input: { workspaceId: string; plan: PaidPlanSlug },
): Promise<PlanChangeOutcome> {
  const db = getDb();

  const [subscription] = await db
    .select()
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.workspaceId, input.workspaceId));

  if (!subscription) throw new NoSubscriptionError();

  const current = planFor(subscription.planSlug).slug;
  const direction = planChangeDirection(current, input.plan);

  if (direction === "upgrade") {
    await provider.changePlan({
      subscriptionId: subscription.providerSubscriptionId,
      plan: input.plan,
      when: "now",
    });

    /* Re-read rather than assume: the provider has just accepted a payment,
       and its account of the subscription is now newer than ours.

       This is also what retires a scheduled downgrade the writer has changed
       their mind about. An immediate change cancels a pending one at the
       provider — measured, not assumed — so re-reading is what turns "Starter
       from 4 October" back into nothing. Clearing it here by hand would be a
       second opinion about a fact we can simply ask for.

       The allowance is not topped up here either, for the same reason: the
       sync notices that the plan rose and credits the difference itself, under
       an id keyed to the period and the destination plan. One writer, so an
       upgrade made through the provider's portal is treated exactly like one
       made through this function. */
    await syncWorkspaceFromProvider(provider, input.workspaceId);

    return {
      planSlug: input.plan,
      pendingPlanSlug: null,
      effectiveAt: new Date(),
      direction,
    };
  }

  /**
   * A downgrade, or the writer changing their mind about one.
   *
   * Polar supersedes a pending change with the next request rather than
   * queueing behind it, so asking for the plan already in force is how a
   * scheduled downgrade is called off.
   */
  await provider.changePlan({
    subscriptionId: subscription.providerSubscriptionId,
    plan: input.plan,
    when: "next_period",
  });

  const effectiveAt = subscription.currentPeriodEnd;
  const pending = direction === "same" ? null : input.plan;

  await db
    .update(billingSubscriptions)
    .set({
      pendingPlanSlug: pending,
      pendingPlanAt: pending ? effectiveAt : null,
    })
    .where(eq(billingSubscriptions.workspaceId, input.workspaceId));

  return {
    planSlug: current,
    pendingPlanSlug: pending,
    effectiveAt: pending ? effectiveAt : null,
    direction,
  };
}

/**
 * Calls off a scheduled cancellation.
 *
 * Cancelling stays in the provider's portal, but changing one's mind must not:
 * somebody who cancelled an hour ago and regretted it should find the way back
 * on the page that told them their plan was ending, not by navigating a
 * billing portal a second time. It is also a prerequisite rather than a
 * courtesy — the provider refuses every plan change while a cancellation is
 * pending, so without this the whole plan section is a dead end.
 */
export async function resumeWorkspaceSubscription(
  provider: BillingProvider,
  workspaceId: string,
): Promise<{ planSlug: PlanSlug }> {
  const [subscription] = await getDb()
    .select({ id: billingSubscriptions.providerSubscriptionId })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.workspaceId, workspaceId));

  if (!subscription) throw new NoSubscriptionError();

  await provider.resumeSubscription(subscription.id);
  // The provider's answer, not ours: it is the one that knows whether the
  // cancellation is really off.
  return syncWorkspaceFromProvider(provider, workspaceId);
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

/**
 * Money given back, and what that costs the workspace.
 *
 * Refunds are issued from Polar's dashboard, not from this app — Polar is the
 * merchant of record, a refund carries invoice and tax consequences, and an
 * in-app "request a refund" button would solicit the very thing that cancelling
 * at period end already answers. But a refund issued *there* has to be honoured
 * *here*, and by default it is not: Polar's `revoke_benefits` flag applies only
 * to one-off purchases, so refunding a subscription order leaves the
 * subscription live, the plan in force, and the next month's charge scheduled.
 *
 * The rules, and the reasoning behind each:
 *
 * - **A full refund of the order that paid for the current period ends access
 *   now.** The month's money has gone back; letting the month stand as well is
 *   paying twice. Nothing the writer has written is affected — dropping to
 *   Free touches the allowance and the model picker, never the manuscript — so
 *   there is nothing a grace period would protect.
 * - **A partial refund changes nothing.** Giving back half is a deliberate
 *   gesture: keep the month. If the intent was to end it, the subscription is
 *   cancelled alongside, and that arrives as its own event.
 * - **A refund of an older order changes nothing.** Whatever happened last
 *   quarter, this period has been paid for.
 * - **A refunded pack takes its words back**, floored at zero.
 */
export async function applyRefund(
  provider: BillingProvider,
  refund: {
    refundId: string;
    orderId: string;
    amount: number;
    currency: string;
    reason: string;
  },
): Promise<void> {
  const db = getDb();

  /* The refund payload names an order and a customer id — not a workspace and
     not a product. Everything the decision rests on comes from reading the
     order back, which is also how "was the whole order refunded" is answered
     by the provider rather than by our arithmetic. */
  const order = await provider.getOrder(refund.orderId);
  if (!order?.externalId) return;

  const workspaceId = order.externalId;
  const full = order.fullyRefunded;
  const resolved = order.productId ? resolveProduct(order.productId) : null;

  /* Claimed before anything is undone. One refund arrives as `created` and
     again as `updated`, which are separate deliveries with separate ids, so
     the delivery-level guard upstream does not cover this: without the claim,
     a subscription could be revoked twice and a pack's words taken twice. */
  const [claimed] = await db
    .insert(billingRefunds)
    .values({
      id: refund.refundId,
      workspaceId,
      providerOrderId: order.id,
      providerSubscriptionId: order.subscriptionId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      fullyRefunded: full,
    })
    .onConflictDoNothing({ target: billingRefunds.id })
    .returning({ id: billingRefunds.id });

  if (!claimed) return;

  const outcome = await (async (): Promise<string> => {
    if (!full) return "partial refund — plan and words left alone";

    if (resolved?.type === "topup") {
      await ensureBalance(workspaceId);
      await clawbackTopupWords({
        workspaceId,
        words: TOPUP_PACKS[resolved.pack].words,
        requestId: `polar_refund:${refund.refundId}`,
        note: `refunded ${TOPUP_PACKS[resolved.pack].label}`,
      });
      return `top-up reclaimed (${TOPUP_PACKS[resolved.pack].words} words)`;
    }

    if (resolved?.type !== "plan") return "unrecognised product — nothing to do";

    const [subscription] = await db
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.workspaceId, workspaceId));

    /* Only the order that paid for the period now running. An older invoice
       being refunded says nothing about whether today is paid for. */
    const paysForNow =
      subscription?.providerSubscriptionId === order.subscriptionId &&
      subscription?.currentPeriodStart != null &&
      order.createdAt >= subscription.currentPeriodStart;

    if (!paysForNow) return "not the current period — plan left alone";

    await provider.revokeSubscription(subscription.providerSubscriptionId);
    // Revoking fires `subscription.revoked`, but waiting for it would leave
    // the workspace on a plan it has been refunded for until the delivery
    // lands. Read the truth now; the webhook is then a no-op.
    await syncWorkspaceFromProvider(provider, workspaceId);
    await clampPlanWords({
      workspaceId,
      ceiling: FREE_PLAN.monthlyWords,
      requestId: `polar_refund:${refund.refundId}`,
      note: "refunded period",
    });

    return `subscription revoked, plan words capped at ${FREE_PLAN.monthlyWords}`;
  })();

  await db
    .update(billingRefunds)
    .set({ outcome })
    .where(eq(billingRefunds.id, refund.refundId));
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

    case "refund_succeeded":
      await applyRefund(provider, event);
      return;

    case "ignored":
      return;
  }
}
