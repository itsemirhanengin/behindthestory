"use client";

import Link from "next/link";
import {
  RiCornerDownRightLine,
  RiDeleteBinLine,
  RiEditLine,
  RiGitBranchLine,
  RiMoreLine,
  RiScissorsLine,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Chapter, Character } from "@/db/schema";

export type Slot = {
  number: number;
  act: number;
  active: Chapter;
  variants: Chapter[];
};

function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function ChapterCard({
  slot,
  novelId,
  cast,
  highlighted,
  dimmed,
  onActivateVariant,
  onAddVariant,
  onToggleContinues,
  onInsertAfter,
  onDelete,
}: {
  slot: Slot;
  novelId: string;
  cast: Character[];
  highlighted: boolean;
  dimmed: boolean;
  onActivateVariant: (chapter: Chapter) => void;
  onAddVariant: () => void;
  onToggleContinues: () => void;
  onInsertAfter: () => void;
  onDelete: () => void;
}) {
  const chapter = slot.active;
  const wordCount = words(chapter.content);

  return (
    <div
      className={cn(
        "group relative flex w-[var(--slot-w)] shrink-0 flex-col rounded-xl border bg-card/60 p-3 transition-all",
        "hover:border-primary/50 hover:bg-accent/40 focus-within:border-primary/50",
        highlighted && "border-primary/60 bg-primary/5",
        dimmed && "opacity-35",
      )}
    >
      {/*
        The whole card is the link. It sits above the card body (z-10) so a
        click anywhere lands on a real anchor — cmd/middle click and prefetch
        keep working — and the few interactive controls are lifted to z-20.
      */}
      <Link
        href={`/novels/${novelId}/write/${chapter.id}`}
        aria-label={`Open chapter ${slot.number}: ${chapter.title}`}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="flex items-start justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Chapter {slot.number}
        </span>
        <div className="relative z-20 flex items-center gap-1">
          <span
            className={cn(
              "size-1.5 rounded-none",
              chapter.status === "final"
                ? "bg-affirm"
                : "bg-muted-foreground/40",
            )}
            title={chapter.status}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-5">
                <RiMoreLine className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={onAddVariant}>
                <RiGitBranchLine className="size-4" /> New variant
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onInsertAfter}>
                <RiCornerDownRightLine className="size-4" /> Insert chapter after
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleContinues}>
                <RiScissorsLine className="size-4" />
                {chapter.continuesFromPrevious
                  ? "Start fresh here"
                  : "Continue from previous"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <RiDeleteBinLine className="size-4" /> Delete chapter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug transition-colors group-hover:text-primary">
        {chapter.title}
      </p>

      <p className="mt-1.5 line-clamp-3 min-h-[2.4rem] text-[11px] leading-snug text-muted-foreground">
        {chapter.summary ||
          (wordCount > 0
            ? "Written, but not analyzed yet."
            : chapter.beats.length
              ? `${chapter.beats.length} beats planned.`
              : "Not written yet.")}
      </p>

      {cast.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {cast.slice(0, 4).map((c) => (
            <span
              key={c.id}
              title={c.name}
              className="flex size-4 items-center justify-center rounded-none text-[8px] font-semibold text-white"
              style={{ backgroundColor: c.color }}
            >
              {c.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")}
            </span>
          ))}
        </div>
      )}

      {slot.variants.length > 1 && (
        <div className="relative z-20 mt-2 flex flex-wrap items-center gap-1 border-t pt-2">
          <span className="text-[9px] uppercase text-muted-foreground">
            takes
          </span>
          {slot.variants.map((v) => (
            <button
              key={v.id}
              title={
                v.isActive
                  ? "Active take"
                  : `Switch to take ${v.variantLabel || "A"}`
              }
              onClick={() => onActivateVariant(v)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                v.isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {v.variantLabel || "A"}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t pt-2">
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {wordCount.toLocaleString()} words
        </span>
        {/* Affordance only — the card itself is the link. */}
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors group-hover:text-primary">
          <RiEditLine className="size-3" /> Write
        </span>
      </div>

      {!chapter.continuesFromPrevious && slot.number > 1 && (
        <Badge
          variant="outline"
          className="mt-1.5 w-fit text-[9px] uppercase"
          title="The AI is not given the previous chapter's closing text"
        >
          starts fresh
        </Badge>
      )}
    </div>
  );
}
