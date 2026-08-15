import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { BillingSettings } from "@/components/billing/billing-settings";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Billing · BehindTheStory",
};

/**
 * A static segment outside `/novels`, so it does not inherit the novel chrome.
 *
 * The panel is a client component — it reads `useSearchParams` to notice the
 * return from checkout, which is what puts it inside a `Suspense` boundary.
 */
export default function BillingPage() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to your novels
        </Link>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Your plan, what is left of it, and where it went.
        </p>
      </header>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <BillingSettings />
      </Suspense>
    </main>
  );
}
