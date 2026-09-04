"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  RiBankCardLine,
  RiLogoutBoxRLine,
  RiMoonLine,
  RiSunLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession, useSignOut } from "@/lib/queries/session";

/**
 * The account, and everything that belongs to the person rather than to the
 * page: the plan, the theme, the way out.
 *
 * These used to be three bare icon buttons sitting in the page heading, which
 * gave the destructive one exactly the same weight as the theme switch. Behind
 * one avatar they read as what they are — account business, not page controls.
 */
export function AccountMenu() {
  const router = useRouter();
  const { data, isPending } = useSession();
  const signOut = useSignOut();
  const { resolvedTheme, setTheme } = useTheme();

  // No mounted guard here, unlike the standalone toggle: the menu's content is
  // not in the DOM until it opens, so by the time this row renders the client
  // has resolved the theme and the label cannot flip in front of the reader.
  const night = resolvedTheme === "dark";

  if (isPending) return <Skeleton className="size-8 shrink-0" />;

  if (!data?.user) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }

  const { email } = data.user;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className="shrink-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Avatar>
            <AvatarFallback className="bg-primary/10 font-medium text-primary uppercase">
              {email.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="label-caps">Signed in as</span>
          <span className="truncate font-normal text-foreground">{email}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings/billing">
            <RiBankCardLine className="size-4" />
            Plan &amp; billing
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setTheme(night ? "light" : "dark");
          }}
        >
          {night ? (
            <RiSunLine className="size-4" />
          ) : (
            <RiMoonLine className="size-4" />
          )}
          {night ? "Switch to paper" : "Switch to ink"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          disabled={signOut.isPending}
          onSelect={() =>
            signOut.mutate(undefined, {
              onSuccess: () => router.refresh(),
              onError: (error) => toast.error(error.message),
            })
          }
        >
          <RiLogoutBoxRLine className="size-4" />
          {signOut.isPending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
