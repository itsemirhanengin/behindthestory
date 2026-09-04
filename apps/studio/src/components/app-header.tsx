"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { RiMenuLine } from "@remixicon/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/components/account-menu";
import { useAppShell } from "@/components/app-shell";
import { useBillingSummary, useWorkspaces } from "@/lib/queries/billing";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * The bar that names the page you are on, and holds what belongs to you rather
 * than to the page.
 *
 * Opaque rather than translucent: with no shadows in this world, a change of
 * ground and a hairline are the only things separating the bar from the page
 * scrolling under it, and both stop working through a blur.
 */
export function AppHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  const { openNavigation } = useAppShell();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-2 shrink-0 lg:hidden"
        aria-label="Open navigation"
        onClick={openNavigation}
      >
        <RiMenuLine className="size-5" />
      </Button>

      <h1 className="min-w-0 flex-1 truncate font-heading text-base font-semibold tracking-tight">
        {title}
      </h1>

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {/* The rail's gauge is the real one. This stands in for it wherever the
            rail is collapsed, because a balance nobody can see before they run
            out is not a warning. */}
        <BalanceChip className="lg:hidden" />
        <AccountMenu />
      </div>
    </header>
  );
}

function BalanceChip({ className }: { className?: string }) {
  const workspaces = useWorkspaces();
  const summary = useBillingSummary(workspaces.data?.[0]?.id);

  if (!summary.data) return null;

  const remaining = summary.data.balance.totalRemaining;
  const allowance = summary.data.plan.monthlyWords;
  const low = allowance > 0 && remaining <= allowance * 0.1;

  return (
    <Button
      asChild
      variant={low ? "outline" : "ghost"}
      size="sm"
      className={cn(low && "border-caution/60 text-caution", className)}
    >
      <Link
        href="/settings/billing"
        title={`${remaining.toLocaleString()} words left`}
      >
        <span className="tabular-nums">{compact.format(remaining)}</span>
        <span className="sr-only"> words left</span>
      </Link>
    </Button>
  );
}
