"use client";

import { RiArrowLeftSLine, RiArrowRightSLine, RiTimeLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * Moves the canvas through the novel. `value` is the chapter whose state is on
 * screen; `max` is the last chapter on the spine.
 *
 * The ticks are not decoration — they mark the chapters where something actually
 * changed, so a 685-chapter novel still shows the author where to look instead
 * of making them drag blindly.
 */
export function ChapterScrubber({
  value,
  max,
  changedAt,
  onChange,
  className,
}: {
  value: number;
  max: number;
  changedAt: number[];
  onChange: (next: number) => void;
  className?: string;
}) {
  const atLatest = value >= max;
  const step = (delta: number) =>
    onChange(Math.min(max, Math.max(1, value + delta)));

  // Jump to the next/previous chapter that changed something, which is what the
  // author is actually looking for when they reach for these.
  const jump = (dir: 1 | -1) => {
    const sorted = [...changedAt].sort((a, b) => a - b);
    const next =
      dir === 1
        ? sorted.find((n) => n > value)
        : [...sorted].reverse().find((n) => n < value);
    if (next !== undefined) onChange(Math.min(max, Math.max(1, next)));
    else step(dir);
  };

  return (
    <div
      className={cn(
        "flex w-[26rem] flex-col gap-1.5 rounded-xl border bg-card px-3 py-2",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <RiTimeLine className="size-3.5 shrink-0 text-primary" />
        <span className="text-xs font-medium">
          Chapter {value}
          <span className="text-muted-foreground"> / {max}</span>
        </span>
        {atLatest && (
          <span className="rounded-none bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
            latest
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            title="Previous change"
            onClick={() => jump(-1)}
            disabled={value <= 1}
          >
            <RiArrowLeftSLine className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            title="Next change"
            onClick={() => jump(1)}
            disabled={atLatest}
          >
            <RiArrowRightSLine className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onClick={() => onChange(max)}
            disabled={atLatest}
          >
            Now
          </Button>
        </div>
      </div>

      <div className="relative">
        <Slider
          min={1}
          max={Math.max(1, max)}
          step={1}
          value={[Math.min(value, Math.max(1, max))]}
          onValueChange={([v]) => onChange(v)}
        />
        {max > 1 && (
          <div className="pointer-events-none absolute inset-x-0 -bottom-1.5 h-1.5">
            {changedAt
              .filter((n) => n >= 1 && n <= max)
              .map((n) => (
                <span
                  key={n}
                  className="absolute top-0 h-1.5 w-px bg-primary/50"
                  style={{ left: `${((n - 1) / Math.max(1, max - 1)) * 100}%` }}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
