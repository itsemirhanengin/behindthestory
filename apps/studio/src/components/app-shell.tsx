"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  RiAddLine,
  RiBankCardLine,
  RiBookOpenLine,
  RiBookShelfLine,
} from "@remixicon/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useBillingSummary, useWorkspaces } from "@/lib/queries/billing";
import { useCreateNovelDraft } from "@/lib/queries/novel-drafts";

/**
 * The signed-in chrome for everything outside a novel: a fixed rail on the
 * left, a page header on top, the page itself in the remaining column.
 *
 * `/novels/*` deliberately does not use this — that route has its own rail,
 * scoped to one manuscript, and two levels of navigation stacked on each other
 * would leave the writer unsure which one "Characters" belongs to.
 */

const AppShellContext = createContext<{
  openNavigation: () => void;
} | null>(null);

export function useAppShell() {
  const value = useContext(AppShellContext);
  if (!value) throw new Error("useAppShell must be used inside <AppShell>");
  return value;
}

const navigation = [
  { href: "/", label: "Your novels", icon: RiBookShelfLine },
  { href: "/settings/billing", label: "Plan & billing", icon: RiBankCardLine },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <AppShellContext.Provider
      value={{ openNavigation: () => setNavigationOpen(true) }}
    >
      <div className="flex min-h-full flex-1">
        {/* The rail is its own scroll context and its own ground: one step off
            the page, which is how surfaces separate in a world with no
            shadows. */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
          <RailContent onNavigate={() => setNavigationOpen(false)} />
        </aside>

        <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
          <SheetContent
            side="left"
            className="w-[min(17rem,86vw)] gap-0 bg-sidebar p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Your novels, and your plan.
            </SheetDescription>
            <RailContent onNavigate={() => setNavigationOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </AppShellContext.Provider>
  );
}

function RailContent({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const createDraft = useCreateNovelDraft();

  // Minting the draft row first is what lets several half-described novels sit
  // side by side; the wizard then lives at that row's id.
  function startNovel() {
    createDraft.mutate(undefined, {
      onSuccess: (draft) => {
        onNavigate();
        router.push(`/novels/drafts/${draft.id}`);
      },
      onError: (cause) => toast.error(cause.message),
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <RiBookOpenLine className="size-5 shrink-0 text-primary" />
        <Link
          href="/"
          onClick={onNavigate}
          className="font-heading text-[0.9375rem] font-semibold tracking-tight"
        >
          BehindTheStory
        </Link>
      </div>

      <div className="p-3">
        <Button
          className="w-full justify-start"
          size="lg"
          onClick={startNovel}
          disabled={createDraft.isPending}
        >
          <RiAddLine className="size-4" />
          {createDraft.isPending ? "Opening…" : "New novel"}
        </Button>
      </div>

      <nav className="space-y-0.5 px-3" aria-label="Main">
        {navigation.map(({ href, label, icon: Icon }) => {
          // "/" would otherwise match every route on the platform.
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-base/6 font-medium transition-colors sm:text-sm/5",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <WordBalance />
      </div>
    </div>
  );
}

/**
 * What is left, and the way to buy more.
 *
 * Pinned to the rail rather than kept on the billing page, because running out
 * is not something anybody goes looking for — it happens mid-sentence, and the
 * number has to have been visible beforehand for that to feel fair. The header
 * carries a compact copy of it wherever the rail is collapsed.
 */
function WordBalance() {
  const workspaces = useWorkspaces();
  const summary = useBillingSummary(workspaces.data?.[0]?.id);

  // Owns its own rule, so a rail with no balance to show — signed out, or a
  // session the API has since rejected — ends at the last nav item instead of
  // at an empty bordered block.
  if (summary.isError || workspaces.isError || workspaces.data?.length === 0) {
    return null;
  }

  if (!summary.data) {
    return (
      <div className="border-t p-3">
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const { balance, plan } = summary.data;
  const remaining = balance.totalRemaining;
  const allowance = plan.monthlyWords;
  const low = allowance > 0 && remaining <= allowance * 0.1;
  // Top-ups do not expire, so they can push the total past a month's
  // allowance. The gauge is capped rather than allowed to overflow its track.
  const filled = allowance > 0 ? Math.min(100, (remaining / allowance) * 100) : 0;

  return (
    <Link
      href="/settings/billing"
      className="block border-t p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-caps">{plan.label} plan</span>
        <span
          className={cn(
            "text-xs tabular-nums",
            low ? "font-medium text-caution" : "text-muted-foreground",
          )}
        >
          {remaining.toLocaleString()}
        </span>
      </div>
      {/* A printed gauge: a rule that is partly inked, not a rounded pill. */}
      <div
        className="mt-2 h-1 w-full bg-border"
        role="img"
        aria-label={`${remaining.toLocaleString()} of ${allowance.toLocaleString()} words left this period`}
      >
        <div
          className={cn("h-full", low ? "bg-caution" : "bg-primary")}
          style={{ width: `${filled}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {low ? "Words running low" : "words left"}
      </p>
    </Link>
  );
}
