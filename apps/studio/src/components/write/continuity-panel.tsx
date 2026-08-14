"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RiLoader4Line, RiShieldCheckLine, RiShieldCrossLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAiContinuity } from "@/lib/queries/ai";
import { cn } from "@/lib/utils";

type Issue = {
  severity: "high" | "medium" | "low";
  type: string;
  quote: string;
  issue: string;
  suggestion: string;
  locatable: boolean;
};

const SEVERITY_STYLES: Record<Issue["severity"], string> = {
  high: "border-alarm/50 bg-alarm/5",
  medium: "border-caution/40 bg-caution/5",
  low: "border-border bg-card/40",
};

const TYPE_LABELS: Record<string, string> = {
  contradiction: "Contradiction",
  continuity: "Continuity",
  voice: "Voice",
  canon_drift: "Style drift",
  unearned: "Unearned",
};

type Props = {
  novelId: string;
  chapterId: string;
  disabled: boolean;
  onLocate: (quote: string) => boolean;
  compact?: boolean;
};

/**
 * Checks a written chapter against the story bible. The analyze flow records
 * what a chapter established; this reports what it got wrong.
 */
export function ContinuityPanel({
  novelId,
  chapterId,
  disabled,
  onLocate,
  compact = false,
}: Props) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const check = useAiContinuity();
  const busy = check.isPending;

  function run() {
    check.mutate(
      { novelId, chapterId },
      {
        onSuccess: (out) => {
          setIssues(out.issues);
          if (out.issues.length === 0) {
            toast.success("No continuity conflicts found");
          }
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className={cn("space-y-2 p-3", !compact && "border-b")}>
        <h3 className="text-sm font-medium">Continuity</h3>
        <p className="text-base/7 text-muted-foreground sm:text-sm/6">
          Reads this chapter against the story bible and reports where it breaks
          canon — dead characters acting, resolved threads re-planted, voice or
          POV drift.
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={run}
          disabled={busy || disabled}
        >
          {busy ? (
            <>
              <RiLoader4Line className="size-4 animate-spin" /> Checking...
            </>
          ) : (
            <>
              <RiShieldCrossLine className="size-4" />
              {issues === null ? "Run check" : "Re-check"}
            </>
          )}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {issues === null ? (
            <p className="text-base/7 text-muted-foreground sm:text-sm/6">
              No continuity check has been run yet.
            </p>
          ) : issues.length === 0 ? (
            <p className="flex items-start gap-2 text-base/7 text-affirm sm:text-sm/6">
              <RiShieldCheckLine className="size-5 shrink-0 sm:size-4" /> This chapter is
              consistent with the story bible.
            </p>
          ) : (
            issues.map((issue, i) => (
              <button
                type="button"
                key={i}
                onClick={() => {
                  if (!issue.locatable || !onLocate(issue.quote)) {
                    toast.error(
                      "Could not locate that passage — the AI paraphrased it.",
                    );
                  }
                }}
                className={cn(
                  "w-full rounded-lg border p-2.5 text-left hover:brightness-125",
                  SEVERITY_STYLES[issue.severity],
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[9px] uppercase">
                    {TYPE_LABELS[issue.type] ?? issue.type}
                  </Badge>
                  <span className="text-muted-foreground">
                    {issue.severity}
                  </span>
                </div>
                <p className="mt-1.5 border-l-2 border-muted-foreground/30 pl-2 text-base/7 italic text-muted-foreground sm:text-sm/6">
                  “{issue.quote}”
                </p>
                <p className="mt-1.5 text-base/7 sm:text-sm/6">{issue.issue}</p>
                <p className="mt-1 text-base/7 text-muted-foreground sm:text-sm/6">
                  → {issue.suggestion}
                </p>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
