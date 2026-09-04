"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RiArrowLeftLine, RiBookOpenLine, RiLoader4Line } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRequestCode, useVerifyCode } from "@/lib/queries/session";

type Step = "email" | "code";

/** `useSearchParams` opts the form out of prerendering, so the boundary is
 *  what keeps the page's own shell static. */
export default function SignInPage() {
  return (
    <Suspense fallback={<Shell />}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  /* Where the proxy turned them away from, so a bookmarked chapter opens as a
     chapter once they are back in. Anything that is not a path on this origin
     is discarded — otherwise `?next=` is an open redirect. */
  const next = params.get("next");
  const returnTo =
    next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  /** They did not come here by choice: their session ended under them. */
  const expired = params.has("expired");
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const requestCode = useRequestCode();
  const verifyCode = useVerifyCode();
  const busy = requestCode.isPending || verifyCode.isPending;
  /** Resending immediately is almost always a misread, not a lost email. */
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  function sendCode(resend = false) {
    if (!email.trim()) return;
    requestCode.mutate(email.trim(), {
      onSuccess: () => {
        setStep("code");
        setCooldown(30);
        if (resend) toast.success("A new code is on its way.");
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function verify(value: string) {
    verifyCode.mutate(
      { email: email.trim(), code: value },
      {
        onSuccess: () => {
          router.replace(returnTo);
          router.refresh();
        },
        onError: (error) => {
          toast.error(error.message);
          // Wrong codes are far more often mistyped than misread, so clear the
          // field and keep focus rather than making them select-all first.
          setCode("");
          codeRef.current?.focus();
        },
      },
    );
  }

  function onCodeChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    // Six digits is the whole input — waiting for a button press after the last
    // one is a keystroke nobody needs.
    if (digits.length === 6 && !busy) verify(digits);
  }

  return (
    <Shell>
      {/* Said plainly and once: nobody clicked "sign out", the session simply
          ran out, and the work is where they left it. */}
      {expired && (
        <p className="mt-6 border-l-2 border-primary/40 pl-3 text-sm/6 text-muted-foreground">
          Your session has ended. Sign in again and you&apos;ll be taken back to
          where you were.
        </p>
      )}

      {step === "email" ? (
          <form
            className="mt-8"
            onSubmit={(event) => {
              event.preventDefault();
              sendCode();
            }}
          >
            <p className="text-muted-foreground">
              Enter your email and we&apos;ll send you a sign-in code. No
              password to remember.
            </p>

            <div className="mt-6 space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <Button type="submit" className="mt-5 w-full" disabled={busy}>
              {busy && <RiLoader4Line className="size-4 animate-spin" />}
              Send code
            </Button>
          </form>
        ) : (
          <div className="mt-8">
            <p className="text-muted-foreground">
              We sent a six-digit code to{" "}
              <span className="text-foreground">{email}</span>. It&apos;s in the
              subject line, so you may not need to open the email.
            </p>

            <div className="mt-6 space-y-2">
              <Label htmlFor="code">Sign-in code</Label>
              <Input
                id="code"
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                disabled={busy}
                onChange={(event) => onCodeChange(event.target.value)}
                className="text-center font-mono text-2xl tracking-[0.4em] indent-[0.4em]"
              />
            </div>

            <div className="mt-5 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep("email");
                  setCode("");
                }}
              >
                <RiArrowLeftLine className="size-4" /> Change email
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={cooldown > 0 || busy}
                onClick={() => sendCode(true)}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </Button>
            </div>

            {busy && (
              <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <RiLoader4Line className="size-4 animate-spin" /> Checking…
              </p>
            )}
          </div>
        )}
    </Shell>
  );
}

/** The masthead and the column, shared by the form and by the boundary above
 *  it so the page does not jump once the search params arrive. */
function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="flex items-center gap-2.5 font-heading text-2xl font-semibold tracking-tight">
          <RiBookOpenLine className="size-6 text-primary" /> BehindTheStory
        </h1>
        {children}
      </div>
    </main>
  );
}
