"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiBankCardLine, RiLogoutBoxRLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { useBillingSummary, useWorkspaces } from "@/lib/queries/billing";
import { useSession, useSignOut } from "@/lib/queries/session";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Signed-in state in the header. Once routes grow a device list and a profile
 * this becomes their entry point; today its job is to make the session visible.
 */
export function AccountMenu() {
  const router = useRouter();
  const { data, isPending } = useSession();
  const signOut = useSignOut();

  if (isPending) return null;

  if (!data?.user) {
    return (
      <Button asChild variant="outline">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <WordBalance />
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {data.user.email}
      </span>
      {/* The balance chip already links here, but "161.4K words" does not read
          as "manage your plan" — the upgrade path needs a word on it. */}
      <Button asChild variant="ghost" size="icon" aria-label="Plan and billing">
        <Link href="/settings/billing">
          <RiBankCardLine className="size-4" />
        </Link>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        disabled={signOut.isPending}
        onClick={() =>
          signOut.mutate(undefined, {
            onSuccess: () => router.refresh(),
            onError: (error) => toast.error(error.message),
          })
        }
      >
        <RiLogoutBoxRLine className="size-4" />
      </Button>
    </div>
  );
}

/**
 * What is left, and the way to buy more.
 *
 * In the header rather than only on the billing page because running out is
 * not a thing anybody goes looking for — it happens mid-sentence, and the
 * number has to have been visible beforehand for that to feel fair.
 */
function WordBalance() {
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
      className={low ? "border-amber-500/60 text-amber-600 dark:text-amber-400" : ""}
    >
      <Link href="/settings/billing" title={`${remaining.toLocaleString()} words left`}>
        <span className="tabular-nums">{compact.format(remaining)}</span>
        <span className="hidden sm:inline">words</span>
      </Link>
    </Button>
  );
}
