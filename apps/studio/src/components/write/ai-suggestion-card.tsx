"use client";

import { useEffect, useRef, useState } from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiFullscreenExitLine,
  RiFullscreenLine,
  RiLoader4Line,
  RiRefreshLine,
  RiStopCircleLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProsePhase, ProseUsage } from "@/lib/prose-stream";

export type AiSuggestion = {
  id: string;
  label: string;
  mode: "insert" | "replace";
  phase: ProsePhase | "starting" | "ready" | "error" | "stopped";
  detail?: string;
  text: string;
  error?: string;
  startedAt: number;
  usage?: ProseUsage;
};

const PHASE_LABELS: Record<AiSuggestion["phase"], string> = {
  starting: "Starting",
  context: "Preparing story context",
  model: "Waiting for the model",
  writing: "Writing suggestion",
  ready: "Ready to review",
  stopped: "Generation stopped",
  error: "Could not generate",
};

export function AiSuggestionCard({
  suggestion,
  onAccept,
  onReject,
  onStop,
  onRetry,
}: {
  suggestion: AiSuggestion;
  onAccept: () => void;
  onReject: () => void;
  onStop: () => void;
  onRetry: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const running = ["starting", "context", "model", "writing"].includes(
    suggestion.phase,
  );

  useEffect(() => {
    const update = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - suggestion.startedAt) / 1000)));
    update();
    if (!running) return;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [running, suggestion.startedAt]);

  useEffect(() => {
    if (!running) return;
    const frame = window.requestAnimationFrame(() => {
      const preview = previewRef.current;
      if (preview) preview.scrollTop = preview.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [running, suggestion.text]);

  const canAccept = suggestion.text.trim().length > 0 && !running;

  return (
    <section
      aria-label="AI writing suggestion"
      className={cn(
        "absolute z-30 mx-auto overflow-hidden rounded-xl bg-popover ring-1 ring-foreground/10 dark:shadow-none",
        expanded
          ? "inset-3 flex max-w-4xl flex-col sm:inset-5"
          : "inset-x-3 bottom-3 max-w-2xl sm:inset-x-6 sm:bottom-5",
      )}
    >
      {running && (
        <div className="h-0.5 overflow-hidden bg-muted">
          <div className="h-full w-1/3 animate-[suggestion-progress_1.4s_ease-in-out_infinite] bg-primary" />
        </div>
      )}

      <div className="flex items-start gap-3 border-b px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-medium">{suggestion.label}</h2>
            <p
              className="text-base/6 tabular-nums text-muted-foreground sm:text-sm/5"
              aria-live="polite"
            >
              {PHASE_LABELS[suggestion.phase]}
              {running ? ` · ${elapsed}s` : ""}
            </p>
          </div>
          {suggestion.detail && (
            <p className="truncate text-base/6 text-muted-foreground sm:text-sm/5">
              {suggestion.detail}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setExpanded((current) => !current)}
            aria-label={expanded ? "Collapse suggestion" : "Expand suggestion"}
            aria-pressed={expanded}
            className="relative"
          >
            {expanded ? <RiFullscreenExitLine /> : <RiFullscreenLine />}
            <span
              className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
              aria-hidden="true"
            />
          </Button>

          {running ? (
            <Button type="button" size="sm" variant="destructive" onClick={onStop}>
              <RiStopCircleLine data-icon="inline-start" /> Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onReject}
              aria-label="Dismiss suggestion"
              className="relative"
            >
              <RiCloseLine />
              <span
                className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                aria-hidden="true"
              />
            </Button>
          )}
        </div>
      </div>

      <div
        ref={previewRef}
        className={cn(
          "overflow-y-auto overscroll-contain px-3 py-3 sm:px-4",
          expanded ? "min-h-0 flex-1" : "max-h-48",
        )}
      >
        {suggestion.text ? (
          <p className="whitespace-pre-wrap font-serif text-lg/8 text-pretty sm:text-[1.0625rem]">
            {suggestion.text}
          </p>
        ) : suggestion.error ? (
          <p className="text-base/7 text-destructive sm:text-sm/6">
            {suggestion.error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-base/7 text-muted-foreground sm:text-sm/6">
            <RiLoader4Line className="size-5 shrink-0 animate-spin sm:size-4" />
            Your manuscript stays untouched while the suggestion is prepared.
          </p>
        )}
      </div>

      {!running && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5 sm:px-4">
          <p className="text-base/6 tabular-nums text-muted-foreground sm:text-sm/5">
            {suggestion.usage
              ? `${suggestion.usage.inputTokens.toLocaleString()} in · ${suggestion.usage.outputTokens.toLocaleString()} out`
              : suggestion.text
                ? `${suggestion.text.trim().split(/\s+/).length.toLocaleString()} words`
                : "No manuscript changes were made."}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
              <RiRefreshLine data-icon="inline-start" /> Try again
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onReject}
            >
              Reject
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onAccept}
              disabled={!canAccept}
            >
              <RiCheckLine data-icon="inline-start" /> Accept
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
