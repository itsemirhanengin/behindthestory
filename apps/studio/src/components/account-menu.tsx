"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiLogoutBoxRLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type SessionResponse = {
  user: { id: string; email: string; displayName: string } | null;
};

/**
 * Signed-in state in the header. Deliberately unopinionated for now — once
 * routes are actually guarded this becomes the entry point for the device list
 * and profile, but today its job is to make the session visible.
 */
export function AccountMenu() {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse | null>(null);

  useEffect(() => {
    api
      .get<SessionResponse>("/api/auth/session")
      .then(setSession)
      .catch(() => setSession({ user: null }));
  }, []);

  if (!session) return null;

  if (!session.user) {
    return (
      <Button asChild variant="outline">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }

  async function signOut() {
    try {
      await api.del("/api/auth/session");
      setSession({ user: null });
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {session.user.email}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        onClick={() => void signOut()}
      >
        <RiLogoutBoxRLine className="size-4" />
      </Button>
    </div>
  );
}
