"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { MODEL_CATALOGUE, type ModelId } from "@behindthestory/ai/models";
import { ROUTE_WORD_COST } from "@behindthestory/core/plans";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBillingCatalogue,
  useBillingSummary,
  useChangePlan,
  useOpenPortal,
  useSetWorkspaceModel,
  useStartCheckout,
  useSyncBilling,
  useWorkspaces,
} from "@/lib/queries/billing";

const words = new Intl.NumberFormat("en-US");
const money = (cents: number) =>
  cents === 0 ? "Free" : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const exactMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const day = (value: string | Date) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
  });

/** What the writer sees on the analysis buttons, so the page agrees with them. */
const ACTION_LABELS: Array<[route: string, label: string]> = [
  ["continuity", "Continuity check"],
  ["analyze", "Chapter analysis"],
  ["relationships", "Relationship suggestions"],
  ["outline", "Chapter plan"],
  ["character", "Character"],
  ["location", "Location"],
];

export function BillingSettings() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaces = useWorkspaces();
  const catalogue = useBillingCatalogue();

  // One workspace per account today; the picker arrives with real teams.
  const workspace = workspaces.data?.[0];
  const summary = useBillingSummary(workspace?.id);
  const checkout = useStartCheckout(workspace?.id);
  const changePlan = useChangePlan(workspace?.id);
  const portal = useOpenPortal(workspace?.id);
  const setModel = useSetWorkspaceModel(workspace?.id);
  const sync = useSyncBilling(workspace?.id);

  /**
   * Coming back from the provider, ask it directly rather than waiting for the
   * webhook: the redirect and the webhook race each other, and losing that
   * race means telling somebody who just paid that they are still on Free.
   *
   * `?checkout=success` is the provider's redirect talking, and it is an event
   * rather than a state — but it stays in the address bar, so every later
   * reload of that URL used to re-announce a payment that had happened once
   * and re-run the sync. Handled exactly once: a ref because a remount must
   * not repeat it, and the parameter is then dropped from the URL so a
   * refresh, a bookmark or the back button cannot either.
   */
  const justCheckedOut = searchParams.get("checkout") === "success";
  const announcedCheckout = useRef(false);
  useEffect(() => {
    if (!justCheckedOut || !workspace?.id || announcedCheckout.current) return;
    announcedCheckout.current = true;
    toast.success("Payment received — updating your plan…");
    sync.mutate();
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justCheckedOut, workspace?.id]);

  const canManage = workspace?.role === "owner" || workspace?.role === "admin";

  const usedThisPeriod = useMemo(
    () => summary.data?.usage.reduce((total, row) => total + row.words, 0) ?? 0,
    [summary.data],
  );

  if (workspaces.isLoading || summary.isLoading || catalogue.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!workspace || !summary.data || !catalogue.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load billing for this account.
      </p>
    );
  }

  const { plan, balance, subscription, refund } = summary.data;
  const renewal = subscription?.currentPeriodEnd ?? null;
  const pending = subscription?.pendingPlanSlug ?? null;
  const pendingLabel = catalogue.data.plans.find((p) => p.slug === pending)?.label;
  /**
   * A refund only explains the plan while it is still the reason for it. Once
   * they have subscribed again, the story on this page is the new plan, and an
   * old refund notice hanging around reads as a second thing having gone wrong.
   */
  const refundExplainsPlan = refund && !subscription;
  const allowance = plan.monthlyWords;
  const usedOfAllowance = Math.max(allowance - balance.planWordsRemaining, 0);
  const percentUsed = allowance > 0 ? Math.min(100, (usedOfAllowance / allowance) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* ---- Nothing to buy until the provider is wired up ---- */}
      {!catalogue.data.configured ? (
        <section className="space-y-1 rounded-xl border border-amber-500/50 bg-amber-500/5 p-5">
          <h2 className="text-sm font-semibold">Payments are not connected yet</h2>
          <p className="text-xs text-muted-foreground">
            The plans below are real and the allowance above is being enforced,
            but nothing can be bought until this deployment has its Polar
            credentials. Set <code>POLAR_ACCESS_TOKEN</code> and the{" "}
            <code>POLAR_PRODUCT_*</code> ids, then restart the API.
          </p>
        </section>
      ) : null}

      {/* ---- Why this plan, when the writer did not choose it ---- */}
      {refundExplainsPlan ? (
        <section className="space-y-2 rounded-xl border bg-card/40 p-5">
          <h2 className="text-sm font-semibold">Your subscription was refunded</h2>
          <p className="text-xs/5 text-muted-foreground">
            {exactMoney(refund.amount)} went back on {day(refund.createdAt)} — card
            refunds usually take a few days to appear. You&apos;re on Free now, with{" "}
            {words.format(plan.monthlyWords)} words a month, and the words left over
            from the refunded period were removed.
            {balance.topupWordsRemaining > 0 ? (
              <>
                {" "}
                Your top-ups aren&apos;t affected —{" "}
                {words.format(balance.topupWordsRemaining)} words are still yours.
              </>
            ) : null}{" "}
            Everything you wrote is untouched.
          </p>
        </section>
      ) : null}

      {/* ---- Current plan and what is left ---- */}
      <section className="space-y-4 rounded-xl border bg-card/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">{plan.label}</h2>
            <p className="text-xs text-muted-foreground">
              {words.format(allowance)} words a month
              {subscription?.cancelAtPeriodEnd
                ? " · ends at the close of this period"
                : ""}
            </p>
            {/* The two halves of a scheduled downgrade, in the order they
                happen: what they have now, and what replaces it when. */}
            {pending && pendingLabel && renewal ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.label} until {day(renewal)}, then {pendingLabel}. Nothing is
                charged before that.
              </p>
            ) : null}
          </div>
          {canManage && subscription ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => portal.mutate()}
              disabled={portal.isPending}
            >
              Manage subscription
            </Button>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <Figure
              value={words.format(balance.planWordsRemaining)}
              label="plan words left"
            />
            {balance.topupWordsRemaining > 0 ? (
              <Figure
                value={words.format(balance.topupWordsRemaining)}
                label="top-up words (never expire)"
              />
            ) : null}
            <Figure value={words.format(usedThisPeriod)} label="used this period" />
            {balance.periodEnd ? (
              <Figure
                value={new Date(balance.periodEnd).toLocaleDateString()}
                label="resets"
              />
            ) : null}
          </div>
        </div>
      </section>

      {/* ---- Model ---- */}
      {plan.modelPicker ? (
        <section className="space-y-3 rounded-xl border bg-card/40 p-5">
          <div>
            <h2 className="text-sm font-semibold">Writing model</h2>
            <p className="text-xs text-muted-foreground">
              Used for chapter drafts and inline edits. A word costs the same
              whichever you pick — analysis always runs on the fastest model.
            </p>
          </div>
          <Select
            value={workspace.defaultModel ?? plan.models[0]}
            onValueChange={(value) => {
              setModel.mutate(value, {
                onSuccess: () => toast.success("Writing model updated"),
                onError: (error) => toast.error((error as Error).message),
              });
            }}
            disabled={!canManage || setModel.isPending}
          >
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {plan.models.map((id) => (
                <SelectItem key={id} value={id}>
                  {MODEL_CATALOGUE[id as ModelId]?.label ?? id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>
      ) : null}

      {/* ---- Where the words went ---- */}
      <section className="space-y-3 rounded-xl border bg-card/40 p-5">
        <div>
          <h2 className="text-sm font-semibold">This period</h2>
          <p className="text-xs text-muted-foreground">
            Words charged since {new Date(balance.periodStart).toLocaleDateString()}.
          </p>
        </div>
        {summary.data.usage.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing generated yet.</p>
        ) : (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {summary.data.usage.map((row) => (
              <li key={row.route} className="flex justify-between gap-4">
                <span className="font-medium text-foreground">{row.route}</span>
                <span className="tabular-nums">
                  {row.calls} × · {words.format(row.words)} words
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Plans ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Plans</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {catalogue.data.plans.map((option) => {
            const current = option.slug === plan.slug;
            const cta = planAction({
              option,
              currentSlug: plan.slug,
              currentLabel: plan.label,
              currentPriceCents:
                catalogue.data.plans.find((p) => p.slug === plan.slug)
                  ?.priceCents ?? 0,
              subscribed: Boolean(subscription),
              pending,
              renewal,
            });
            return (
              <div
                key={option.slug}
                /* A column rather than a stack, so the button can be pinned to
                   the floor: the notes above it are two or three lines
                   depending on the plan, and buttons that sit at four
                   different heights read as four different kinds of thing.
                   `gap` rather than `space-y`, which would set a top margin on
                   the button and beat `mt-auto`. */
                className={`flex h-full flex-col gap-3 rounded-xl border p-4 ${
                  current ? "border-primary bg-card/60" : "bg-card/30"
                }`}
              >
                <div>
                  <div className="text-sm font-semibold">{option.label}</div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {money(option.priceCents)}
                    {option.priceCents > 0 ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        /mo
                      </span>
                    ) : null}
                  </div>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>{words.format(option.monthlyWords)} words a month</li>
                  <li>{option.seats === 1 ? "1 seat" : `${option.seats} seats`}</li>
                  <li>
                    {option.modelPicker
                      ? `${option.models.length} models`
                      : "Fastest model"}
                  </li>
                </ul>
                {/* What the click will actually do, before it is clicked.
                    "Choose" on every card hid the only thing the writer needs
                    to know: whether money moves today. */}
                {cta.note ? (
                  <p className="text-xs/5 text-muted-foreground">{cta.note}</p>
                ) : null}
                <Button
                  className="mt-auto w-full"
                  size="sm"
                  variant={current && !cta.act ? "outline" : "default"}
                  disabled={
                    !cta.act ||
                    !canManage ||
                    checkout.isPending ||
                    changePlan.isPending
                  }
                  onClick={() => {
                    const slug = option.slug as "starter" | "pro" | "team";
                    const onError = (error: unknown) =>
                      toast.error((error as Error).message);

                    if (cta.act === "checkout") {
                      checkout.mutate({ type: "plan", plan: slug }, { onError });
                      return;
                    }
                    changePlan.mutate(slug, {
                      onSuccess: (result) => {
                        toast.success(
                          result.direction === "upgrade"
                            ? `You're on ${option.label} now.`
                            : result.pendingPlanSlug && result.effectiveAt
                              ? `${option.label} starts on ${day(result.effectiveAt)}.`
                              : `Staying on ${option.label}.`,
                        );
                      },
                      onError,
                    });
                  }}
                >
                  {cta.label}
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Top-ups ---- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Top-up packs</h2>
          <p className="text-xs text-muted-foreground">
            Bought once, never expire. Spent only after the monthly allowance
            runs out.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {catalogue.data.topups.map((pack) => (
            <div key={pack.key} className="space-y-3 rounded-xl border bg-card/30 p-4">
              <div className="text-sm font-semibold">{pack.label}</div>
              <div className="text-2xl font-semibold tabular-nums">
                {money(pack.priceCents)}
              </div>
              <Button
                className="w-full"
                size="sm"
                variant="outline"
                disabled={!canManage || checkout.isPending}
                onClick={() =>
                  checkout.mutate(
                    { type: "topup", pack: pack.key },
                    { onError: (error) => toast.error((error as Error).message) },
                  )
                }
              >
                Buy
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* ---- What things cost ---- */}
      <section className="space-y-3 rounded-xl border bg-card/40 p-5">
        <div>
          <h2 className="text-sm font-semibold">What things cost</h2>
          <p className="text-xs text-muted-foreground">
            Writing charges the words it produces. Everything else has a fixed
            price, because it reads the whole story to answer.
          </p>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li className="flex justify-between gap-4">
            <span className="font-medium text-foreground">Chapter draft</span>
            <span className="tabular-nums">the words it writes</span>
          </li>
          <li className="flex justify-between gap-4">
            <span className="font-medium text-foreground">Inline edit</span>
            <span className="tabular-nums">the words it writes</span>
          </li>
          {ACTION_LABELS.map(([route, label]) => (
            <li key={route} className="flex justify-between gap-4">
              <span className="font-medium text-foreground">{label}</span>
              <span className="tabular-nums">
                {words.format(ROUTE_WORD_COST[route] ?? 0)} words
              </span>
            </li>
          ))}
          <li className="flex justify-between gap-4">
            <span className="font-medium text-foreground">Indexing a chapter</span>
            <span className="tabular-nums">free</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

/**
 * What one plan card's button does, and what it should promise.
 *
 * All of the awkwardness of plan changes lives in this function on purpose.
 * Whether money moves today, whether the change is immediate, and whether the
 * card is even actionable all depend on the same three facts — the direction,
 * whether there is a subscription to change, and whether a change is already
 * scheduled — and spreading that across the JSX is how a card ends up
 * cheerfully offering "Choose" for something that will not happen for a month.
 *
 * The amounts are deliberately not computed here. Proration is the provider's
 * arithmetic, with tax and discounts in it; a precise figure invented by the
 * client would be wrong exactly when it mattered. So the copy commits to what
 * is certainly true — a credited remainder, and the next full charge.
 */
function planAction(input: {
  option: { slug: string; label: string; priceCents: number };
  currentSlug: string;
  currentLabel: string;
  currentPriceCents: number;
  subscribed: boolean;
  pending: string | null;
  renewal: string | Date | null;
}): { label: string; note: string | null; act: "checkout" | "change" | null } {
  const { option, pending, renewal, subscribed } = input;

  /* Free is not sold. Leaving a paid plan happens by cancelling it, which the
     provider's portal owns — it is their receipt, their card, their invoice. */
  if (option.slug === "free") {
    return {
      label: input.currentSlug === "free" ? "Current plan" : "Cancel to return",
      note:
        input.currentSlug === "free"
          ? null
          : "Cancel from Manage subscription — your plan then runs to the end of the period.",
      act: null,
    };
  }

  // Already scheduled. Saying "From 3 September" twice is enough; a second
  // button that re-requests the same change is a way to fat-finger a charge.
  if (option.slug === pending) {
    return {
      label: renewal ? `From ${day(renewal)}` : "Scheduled",
      note: "Already scheduled. Nothing to do.",
      act: null,
    };
  }

  if (option.slug === input.currentSlug) {
    // The way back from a downgrade they have thought better of.
    if (pending) {
      return {
        label: `Stay on ${option.label}`,
        note: "Cancels the scheduled change and keeps this plan.",
        act: "change",
      };
    }
    return { label: "Current plan", note: null, act: null };
  }

  // No subscription yet: this is a purchase, and it happens at the provider.
  if (!subscribed) {
    return {
      label: "Choose",
      note: `${money(option.priceCents)} a month, starting today.`,
      act: "checkout",
    };
  }

  const upgrade = option.priceCents > input.currentPriceCents;

  if (upgrade) {
    return {
      label: "Upgrade now",
      note: `Starts immediately. The unused part of ${input.currentLabel} is credited against it${
        renewal ? `, then ${exactMoney(option.priceCents)} on ${day(renewal)}` : ""
      }.`,
      act: "change",
    };
  }

  /* The date is repeated from the button on purpose: the note has to read as a
     sentence on its own, and "until then" pointing at a button is not one. */
  return {
    label: renewal ? `Switch on ${day(renewal)}` : "Switch at renewal",
    note: renewal
      ? `Nothing charged today. ${input.currentLabel} runs to ${day(renewal)}, then ${exactMoney(option.priceCents)}.`
      : `Nothing charged today. ${input.currentLabel} runs to the end of this period.`,
    act: "change",
  };
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
