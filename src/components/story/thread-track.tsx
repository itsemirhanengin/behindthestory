"use client";

import { cn } from "@/lib/utils";
import { elementStyles } from "@/components/flow/element-node";
import type { StoryElement } from "@/db/schema";

export type ThreadSpan = {
  element: StoryElement;
  /** 1-based slot where the thread is planted. */
  from: number;
  /** 1-based slot where it pays off, or null while it is still open. */
  to: number | null;
};

/**
 * One thread rendered across the chapter grid: a solid bar from where it was
 * planted to where it paid off, fraying into a dashed tail while it is open.
 *
 * The bar is placed with the same grid columns as the spine above it, so a
 * thread always lines up with the chapters it actually spans.
 */
/**
 * The label and the bar are two cells of the *shared* map grid, placed
 * explicitly. They are not a grid of their own — that is what previously let
 * the bars drift out of alignment with the chapters above them.
 */
export function ThreadTrack({
  span,
  columns,
  row,
  selected,
  onSelect,
}: {
  span: ThreadSpan;
  columns: number;
  row: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = elementStyles[span.element.type];
  const open = span.to === null;
  const end = Math.min(span.to ?? columns, columns);

  return (
    <>
      <button
        onClick={onSelect}
        title={span.element.title}
        style={{ gridRow: row, gridColumn: 1 }}
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors",
          selected ? "bg-accent" : "hover:bg-accent/50",
        )}
      >
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: style.color }}
        />
        <span
          className={cn(
            "truncate text-[11px]",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {span.element.title}
        </span>
      </button>

      <button
        onClick={onSelect}
        style={{ gridRow: row, gridColumn: `${span.from + 1} / ${end + 2}` }}
        className={cn(
          "relative flex h-full items-center",
          selected ? "opacity-100" : "opacity-80 hover:opacity-100",
        )}
      >
        {/* Planted */}
        <span
          className="absolute left-0 z-10 size-2 rounded-full ring-2 ring-background"
          style={{ backgroundColor: style.color }}
        />
        {/* The span. An open thread frays into dashes. */}
        <span
          className="absolute left-0 right-2 h-0.5"
          style={
            open
              ? {
                  backgroundImage: `repeating-linear-gradient(to right, ${style.color} 0 6px, transparent 6px 11px)`,
                  opacity: 0.7,
                }
              : { backgroundColor: style.color }
          }
        />
        {/* Paid off, or still hanging */}
        {open ? (
          <span
            className="absolute right-0 text-[13px] leading-none"
            style={{ color: style.color }}
            title="Planted but never paid off"
          >
            ⌁
          </span>
        ) : (
          <span
            className="absolute right-0 z-10 size-2 rotate-45 ring-2 ring-background"
            style={{ backgroundColor: style.color }}
            title="Paid off here"
          />
        )}
      </button>
    </>
  );
}
