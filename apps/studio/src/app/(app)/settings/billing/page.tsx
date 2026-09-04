import { Suspense } from "react";
import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { BillingSettings } from "@/components/billing/billing-settings";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Billing · BehindTheStory",
};

/**
 * Inside the app shell rather than under `/novels`, so it keeps the rail and
 * does not inherit the novel chrome. The rail is also what replaced this
 * page's own "back to your novels" link.
 *
 * The panel is a client component — it reads `useSearchParams` to notice the
 * return from checkout, which is what puts it inside a `Suspense` boundary.
 */
export default function BillingPage() {
  return (
    <>
      <AppHeader title="Plan & billing" />

      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <p className="text-sm text-muted-foreground">
          Your plan, what is left of it, and where it went.
        </p>

        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <BillingSettings />
        </Suspense>
      </main>
    </>
  );
}
