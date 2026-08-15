"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
  useOpenPortal,
  useSetWorkspaceModel,
  useStartCheckout,
  useSyncBilling,
  useWorkspaces,
} from "@/lib/queries/billing";

const words = new Intl.NumberFormat("en-US");
const money = (cents: number) =>
  cents === 0 ? "Free" : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

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
  const searchParams = useSearchParams();
  const workspaces = useWorkspaces();
  const catalogue = useBillingCatalogue();

  // One workspace per account today; the picker arrives with real teams.
  const workspace = workspaces.data?.[0];
  const summary = useBillingSummary(workspace?.id);
  const checkout = useStartCheckout(workspace?.id);
  const portal = useOpenPortal(workspace?.id);
  const setModel = useSetWorkspaceModel(workspace?.id);
  const sync = useSyncBilling(workspace?.id);

  // Coming back from the provider, ask it directly rather than waiting for the
  // webhook: the redirect and the webhook race each other, and losing that
  // race means telling somebody who just paid that they are still on Free.
  const justCheckedOut = searchParams.get("checkout") === "success";
  useEffect(() => {
    if (!justCheckedOut || !workspace?.id) return;
    toast.success("Payment received — updating your plan…");
    sync.mutate();
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

  const { plan, balance, subscription } = summary.data;
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
            return (
              <div
                key={option.slug}
                className={`space-y-3 rounded-xl border p-4 ${
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
                <Button
                  className="w-full"
                  size="sm"
                  variant={current ? "outline" : "default"}
                  disabled={
                    current ||
                    option.slug === "free" ||
                    !canManage ||
                    checkout.isPending
                  }
                  onClick={() =>
                    checkout.mutate(
                      { type: "plan", plan: option.slug as "starter" | "pro" | "team" },
                      { onError: (error) => toast.error((error as Error).message) },
                    )
                  }
                >
                  {current ? "Current plan" : "Choose"}
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

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
