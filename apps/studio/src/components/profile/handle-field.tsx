"use client";

import { useEffect, useState } from "react";
import { RiCheckLine, RiErrorWarningLine, RiLoader4Line } from "@remixicon/react";

import {
  USERNAME_MAX,
  USERNAME_PROBLEM_MESSAGE,
  normalizeUsername,
  usernameProblem,
} from "@behindthestory/core/username";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUsernameAvailable } from "@/lib/queries/profile";

/**
 * The handle, with a live answer about whether it is free.
 *
 * Shape problems are decided here from the shared rules and never cost a
 * request: "Quiet Folio" is invalid whatever the server thinks, and waiting on
 * a round trip to say so makes the field feel broken. Only a well-formed
 * candidate is worth asking about.
 *
 * The answer is advisory. The unique index is the real arbiter, and the save
 * path handles losing that race — so this exists to stop the writer picking a
 * name they cannot have, not to guarantee they can.
 */
export function HandleField({
  value,
  onChange,
  current,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The handle already saved, which is always "available" to its owner. */
  current: string;
}) {
  const handle = normalizeUsername(value);
  const problem = usernameProblem(handle);
  const unchanged = handle === normalizeUsername(current);

  const [debounced, setDebounced] = useState(handle);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(handle), 300);
    return () => clearTimeout(timer);
  }, [handle]);

  const probe = useUsernameAvailable(
    debounced,
    !problem && !unchanged && debounced === handle,
  );

  const status = (() => {
    if (unchanged) return null;
    if (problem) {
      return { tone: "bad" as const, message: USERNAME_PROBLEM_MESSAGE[problem] };
    }
    if (probe.isFetching || debounced !== handle) {
      return { tone: "waiting" as const, message: "Checking…" };
    }
    if (probe.data?.available) {
      return { tone: "good" as const, message: `${handle} is free.` };
    }
    if (probe.data) {
      return {
        tone: "bad" as const,
        message: probe.data.reason ?? "That handle is taken.",
      };
    }
    return null;
  })();

  return (
    <div className="space-y-1.5">
      <Label htmlFor="username">Handle</Label>

      {/* The prefix is rendered rather than typed, so nobody pastes a whole URL
          into the field and nobody wonders whether to include the slash. */}
      <div className="flex max-w-sm items-center border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <span className="pl-2.5 text-sm text-muted-foreground select-none">@</span>
        <Input
          id="username"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={USERNAME_MAX}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          // The wrapper owns the border and the focus ring; a second set here
          // would draw a box inside a box.
          className="border-0 bg-transparent pl-1 focus-visible:ring-0"
        />
      </div>

      {/* Only the live answer, and only once the handle has been touched. What a
          handle is for does not need saying under a field prefixed with `@`. */}
      {status ? (
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs",
            status.tone === "bad" && "text-alarm",
            status.tone === "good" && "text-affirm",
            status.tone === "waiting" && "text-muted-foreground",
          )}
        >
          {status.tone === "bad" ? (
            <RiErrorWarningLine className="size-3.5 shrink-0" />
          ) : status.tone === "good" ? (
            <RiCheckLine className="size-3.5 shrink-0" />
          ) : (
            <RiLoader4Line className="size-3.5 shrink-0 animate-spin" />
          )}
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
