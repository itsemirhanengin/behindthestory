"use client";

import { RiAlertLine, RiCheckLine } from "@remixicon/react";
import { cn } from "@/lib/utils";
import { elementStyles } from "@/components/flow/element-node";
import type { StoryElement } from "@behindthestory/db/schema";

export type ThreadSpan = {
  element: StoryElement;
  /** 1-based slot where the thread is planted. */
  from: number;
  /** 1-based slot where it pays off, or null while it is still open. */
  to: number | null;
};

export type ThreadFilter = "all" | "open" | "resolved";

/**
 * How many *written* chapters may pass before an unpaid setup counts as stale.
 * Relative to the draft so a 6-chapter novella and a 60-chapter epic both get a
 * sensible warning, with a floor so the opening chapters never look alarming.
 */
function staleAfter(writtenThrough: number) {
  return Math.max(3, Math.ceil(writtenThrough / 2));
}

/** Open threads the draft has genuinely outrun — the ones worth warning about. */
export function countOverdue(threads: ThreadSpan[], writtenThrough: number) {
  const limit = staleAfter(writtenThrough);
  return threads.filter(
    (t) => t.to === null && writtenThrough - t.from >= limit,
  ).length;
}

/** Type · title · span · verdict — one shape for the header and every row. */
const ROW_GRID =
  "grid grid-cols-[7.5rem_minmax(0,1fr)_11rem_6.5rem] items-center gap-3";

const statusWord: Record<StoryElement["status"], string> = {
  planted: "planted",
  developing: "developing",
  resolved: "paid off",
};

/**
 * The span drawn against the whole book, at a fixed width. The bar carries the
 * shape of the thread — where it starts, how much of the draft it covers —
 * while the numbers beside it carry the exact answer. An open thread runs solid
 * only as far as the draft has been written and then bleeds out, because "we
 * have written this far and it still has not paid off" and "this ends at
 * chapter 12" are not the same claim.
 */
function SpanBar({
  span,
  chapterCount,
  writtenThrough,
  color,
}: {
  span: ThreadSpan;
  chapterCount: number;
  writtenThrough: number;
  color: string;
}) {
  const open = span.to === null;
  const pct = (slot: number) => (slot / chapterCount) * 100;
  const left = pct(span.from - 1);
  const right = open ? 100 : pct(span.to as number);
  // Where the solid ink stops. Past the written edge the thread is speculation.
  const solid = open ? Math.max(pct(writtenThrough), left + 2) : right;
  const fadeStart = ((solid - left) / Math.max(right - left, 1)) * 100;

  return (
    <div className="relative h-4">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      {/* The written edge of the draft, so an open bar is read against it. */}
      {open && writtenThrough > 0 && writtenThrough < chapterCount && (
        <span
          className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-border"
          style={{ left: `${pct(writtenThrough)}%` }}
        />
      )}
      <div
        className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-none"
        style={{
          left: `${left}%`,
          width: `${Math.max(right - left, 1)}%`,
          background: open
            ? `linear-gradient(to right, ${color} ${fadeStart}%, transparent)`
            : color,
        }}
      />
      <span
        className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-none"
        style={{ left: `${left}%`, backgroundColor: color }}
      />
      {!open && (
        <span
          className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45"
          style={{ left: `${right}%`, backgroundColor: color }}
        />
      )}
    </div>
  );
}

function ThreadRow({
  span,
  chapterCount,
  writtenThrough,
  selected,
  onSelect,
}: {
  span: ThreadSpan;
  chapterCount: number;
  writtenThrough: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = elementStyles[span.element.type];
  const open = span.to === null;
  // Measured against the written draft, not the outline: a setup cannot be
  // overdue in chapters that do not exist yet.
  const openFor = Math.max(writtenThrough - span.from, 0);
  const stale = open && openFor >= staleAfter(writtenThrough);

  return (
    <div
      className={cn(
        "rounded-lg border border-transparent transition-colors",
        selected ? "border-border bg-accent/60" : "hover:bg-accent/30",
      )}
    >
      <button
        onClick={onSelect}
        className={ROW_GRID + " w-full px-3 py-1.5 text-left"}
      >
        <span
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: style.color }}
        >
          <span
            className="size-1.5 shrink-0 rounded-none"
            style={{ backgroundColor: style.color }}
          />
          <span className="truncate">{style.label}</span>
        </span>

        <span className="truncate text-[13px] text-foreground">
          {span.element.title}
        </span>

        <SpanBar
          span={span}
          chapterCount={chapterCount}
          writtenThrough={writtenThrough}
          color={style.color}
        />

        <span className="text-right">
          <span
            className={cn(
              "flex items-center justify-end gap-1 text-[11px] font-medium",
              stale
                ? "text-caution"
                : open
                  ? "text-muted-foreground"
                  : "text-affirm",
            )}
          >
            {stale && <RiAlertLine className="size-3 shrink-0" />}
            {!open && <RiCheckLine className="size-3 shrink-0" />}
            {open
              ? openFor === 0
                ? "just planted"
                : `${openFor} ch. open`
              : `ch. ${span.to}`}
          </span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            {open
              ? `${statusWord[span.element.status]} ch. ${span.from}`
              : `from ch. ${span.from}`}
          </span>
        </span>
      </button>

      {selected && span.element.description && (
        <p className="px-3 pb-2.5 pl-[8.7rem] text-[11px] leading-relaxed text-muted-foreground">
          {span.element.description}
        </p>
      )}
    </div>
  );
}

/**
 * Threads as a debt board rather than a timeline. Every row says what it is,
 * where it was planted and how long it has been hanging — the three things a
 * writer actually comes here to find out. Unpaid setups sort to the top and
 * carry the warning, because they are the only rows that need acting on.
 */
export function ThreadBoard({
  threads,
  chapterCount,
  writtenThrough,
  filter,
  onFilterChange,
  selected,
  onSelect,
}: {
  threads: ThreadSpan[];
  chapterCount: number;
  /** Highest chapter number that actually has prose in it. */
  writtenThrough: number;
  filter: ThreadFilter;
  onFilterChange: (filter: ThreadFilter) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  // Book order, which for open threads *is* most-stale-first: the earlier a
  // setup was planted, the longer it has gone unpaid.
  const open = threads
    .filter((t) => t.to === null)
    .sort((a, b) => a.from - b.from);
  const resolved = threads
    .filter((t) => t.to !== null)
    .sort((a, b) => a.from - b.from);

  const groups = [
    { key: "open" as const, label: "Open", rows: open },
    { key: "resolved" as const, label: "Paid off", rows: resolved },
  ].filter((g) => filter === "all" || filter === g.key);

  const chips: { key: ThreadFilter; label: string }[] = [
    { key: "all", label: `All ${threads.length}` },
    { key: "open", label: `Open ${open.length}` },
    { key: "resolved", label: `Paid off ${resolved.length}` },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Threads
        </span>
        {threads.length > 0 && (
          <div className="flex items-center gap-1">
            {chips.map((chip) => (
              <button
                key={chip.key}
                onClick={() => onFilterChange(chip.key)}
                className={cn(
                  "rounded-none px-2 py-0.5 text-[11px] transition-colors",
                  filter === chip.key
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {threads.length === 0 && (
          <span className="text-[11px] text-muted-foreground">
            Nothing tracked yet — analyze a written chapter and its twists,
            foreshadowing and plot threads appear here.
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group, gi) => (
          <div key={group.key} className="mb-2 max-w-3xl">
            <div className={ROW_GRID + " px-3 pb-1 pt-2"}>
              <span className="col-span-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label} — {group.rows.length}
              </span>
              {/* The scale the bars are drawn against, stated once. */}
              {gi === 0 && (
                <span className="flex items-center justify-between text-[9px] text-muted-foreground">
                  <span>ch. 1</span>
                  <span>ch. {chapterCount}</span>
                </span>
              )}
            </div>

            {group.rows.length === 0 ? (
              <p className="px-3 py-1.5 text-[11px] text-muted-foreground">
                {group.key === "open"
                  ? "Every thread has been paid off."
                  : "Nothing has paid off yet."}
              </p>
            ) : (
              group.rows.map((span) => (
                <ThreadRow
                  key={span.element.id}
                  span={span}
                  chapterCount={chapterCount}
                  writtenThrough={writtenThrough}
                  selected={selected === span.element.id}
                  onSelect={() =>
                    onSelect(
                      selected === span.element.id ? null : span.element.id,
                    )
                  }
                />
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
