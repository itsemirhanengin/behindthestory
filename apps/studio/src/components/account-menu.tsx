"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiLogoutBoxRLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { useSession, useSignOut } from "@/lib/queries/session";

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
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {data.user.email}
      </span>
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
