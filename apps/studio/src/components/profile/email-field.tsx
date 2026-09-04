"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RiArrowLeftLine, RiMailCheckLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useRequestEmailChange,
  useVerifyEmailChange,
  type Profile,
} from "@/lib/queries/profile";

/**
 * Moving the account to a different address.
 *
 * Separate from the profile form because the proof is different. Everything
 * else is saved because you are signed in; this is saved because you proved you
 * can read the new inbox. Folding it into the same Save button would mean the
 * address could change as a side effect of editing a bio, which is exactly the
 * property a stolen session would exploit.
 *
 * Three states, one at a time: the current address, then the address being
 * confirmed, then back to the first with a new value. No modal — the flow is
 * two fields and belongs inline, where the writer can see what they are
 * changing it *from*.
 */
type Stage =
  | { step: "idle" }
  | { step: "entering" }
  | { step: "confirming"; email: string };

export function EmailField({ profile }: { profile: Profile }) {
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const request = useRequestEmailChange();
  const verify = useVerifyEmailChange();

  function askForCode(next: string) {
    request.mutate(next, {
      onSuccess: () => {
        setStage({ step: "confirming", email: next });
        setCode("");
      },
      onError: (cause) => toast.error(cause.message),
    });
  }

  if (stage.step === "confirming") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 border border-affirm/40 bg-affirm/5 p-3">
          <RiMailCheckLine className="mt-0.5 size-4 shrink-0 text-affirm" />
          {/* The one explanation on this page that earns its place: that the
              account has not moved yet is not visible anywhere else. */}
          <p className="text-sm/6">
            Code sent to <span className="font-medium">{stage.email}</span>.
            Your account stays on{" "}
            <span className="font-medium">{profile.email}</span> until you enter
            it.
          </p>
        </div>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            verify.mutate(
              { email: stage.email, code },
              {
                onSuccess: () => {
                  toast.success("Your address has been updated.");
                  setStage({ step: "idle" });
                  setEmail("");
                  setCode("");
                },
                onError: (cause) => toast.error(cause.message),
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email-code">Confirmation code</Label>
            <Input
              id="email-code"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              // The digits are read in pairs when they are spaced out, which is
              // what makes a six-digit code easy to retype from a phone.
              className="w-40 font-mono tracking-[0.3em] tabular-nums"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              autoFocus
            />
          </div>

          <Button type="submit" disabled={code.length !== 6 || verify.isPending}>
            {verify.isPending ? "Confirming…" : "Confirm address"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            disabled={request.isPending}
            onClick={() => askForCode(stage.email)}
          >
            {request.isPending ? "Sending…" : "Send again"}
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2.5"
          onClick={() => setStage({ step: "idle" })}
        >
          <RiArrowLeftLine className="size-4" />
          Cancel and keep {profile.email}
        </Button>
      </div>
    );
  }

  if (stage.step === "entering") {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          askForCode(email.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="new-email">New address</Label>
          <Input
            id="new-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="max-w-sm"
            autoComplete="email"
            required
            autoFocus
          />
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={!email.trim() || request.isPending}>
            {request.isPending ? "Sending…" : "Send code"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStage({ step: "idle" });
              setEmail("");
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  // The address and the way to change it. The section is titled "Email"; a
  // label saying "Current address" and a line saying "this is how you sign in"
  // were both the same sentence written twice more.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 truncate text-sm">{profile.email}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setStage({ step: "entering" })}
      >
        Change
      </Button>
    </div>
  );
}
