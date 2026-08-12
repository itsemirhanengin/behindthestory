"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
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
  high: "border-rose-500/50 bg-rose-500/5",
  medium: "border-amber-500/40 bg-amber-500/5",
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
}: Props) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const out = await api.post<{ issues: Issue[] }>("/api/ai/continuity", {
        novelId,
        chapterId,
      });
      setIssues(out.issues);
      if (out.issues.length === 0) {
        toast.success("No continuity conflicts found");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <h3 className="text-sm font-semibold">Continuity check</h3>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Reads this chapter against the story bible and reports where it breaks
          canon — dead characters acting, resolved threads re-planted, voice or
          POV drift.
        </p>
        <Button
          size="sm"
          className="w-full"
          onClick={run}
          disabled={busy || disabled}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Checking...
            </>
          ) : (
            <>
              <ShieldAlert className="size-4" />
              {issues === null ? "Run check" : "Re-check"}
            </>
          )}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {issues === null ? (
            <p className="text-[11px] text-muted-foreground">
              Nothing checked yet.
            </p>
          ) : issues.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-emerald-400">
              <ShieldCheck className="size-4" /> This chapter is consistent with
              the story bible.
            </p>
          ) : (
            issues.map((issue, i) => (
              <button
                key={i}
                onClick={() => {
                  if (!issue.locatable || !onLocate(issue.quote)) {
                    toast.error(
                      "Could not locate that passage — the AI paraphrased it.",
                    );
                  }
                }}
                className={cn(
                  "w-full rounded-lg border p-2.5 text-left transition-colors hover:brightness-125",
                  SEVERITY_STYLES[issue.severity],
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[9px] uppercase">
                    {TYPE_LABELS[issue.type] ?? issue.type}
                  </Badge>
                  <span className="text-[9px] uppercase text-muted-foreground">
                    {issue.severity}
                  </span>
                </div>
                <p className="mt-1.5 border-l-2 border-muted-foreground/30 pl-2 text-[11px] italic text-muted-foreground">
                  “{issue.quote}”
                </p>
                <p className="mt-1.5 text-xs">{issue.issue}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
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
