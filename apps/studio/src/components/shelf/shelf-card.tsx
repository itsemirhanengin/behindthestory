import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The shelf's card vocabulary, in one place so a novel and an unfinished draft
 * are visibly the same kind of object.
 *
 * Elevation is declared once, as a hairline ring, and the raised surface goes
 * *lighter* than the ground rather than casting a shadow — the platform's rule
 * for a page lying on a desk. Hover and keyboard focus both warm that ring to
 * the accent, which is the only state the card has.
 */
export function ShelfCard({
  children,
  className,
  dashed = false,
}: {
  children: ReactNode;
  className?: string;
  dashed?: boolean;
}) {
  return (
    <div
      className={cn(
        "group/shelf-card relative flex flex-col bg-card p-4 transition-[box-shadow,background-color]",
        // `has-[a:focus-visible]` is what carries the focus ring to the card
        // itself: the thing actually focused is a transparent overlay link
        // stretched across it, which has nothing of its own to outline.
        dashed
          ? "border border-dashed border-border hover:border-primary/50 has-[a:focus-visible]:border-primary/50"
          : "ring-1 ring-foreground/10 hover:ring-primary/40 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-primary/60",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The line under a title: what this novel is, in the author's own terms. */
export function ShelfCardMeta({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 truncate text-xs text-muted-foreground">{children}</p>
  );
}

/**
 * The footer rule. Pushed to the bottom so cards of unequal text length still
 * line their colophons up across a row — the thing that makes a grid of cards
 * read as a shelf rather than as loose tiles.
 */
export function ShelfCardColophon({ children }: { children: ReactNode }) {
  return (
    <div className="mt-auto flex items-baseline justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
      {children}
    </div>
  );
}
