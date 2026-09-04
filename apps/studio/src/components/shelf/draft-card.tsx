"use client";

import { useState } from "react";
import Link from "next/link";
import { RiCloseLine, RiQuillPenLine } from "@remixicon/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShelfCard, ShelfCardColophon } from "@/components/shelf/shelf-card";
import type { NovelDraft } from "@/lib/queries/novel-drafts";

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const STEPS = 4;

/**
 * The unfinished novel, shelved beside the finished ones.
 *
 * Dashed where the real cards are ringed — the same grammar the empty state
 * uses for "not a book yet" — and it opens the wizard exactly where the author
 * left it, whichever device they left it on.
 */
export function DraftCard({
  draft,
  onDiscard,
  discarding,
}: {
  draft: NovelDraft;
  onDiscard: () => void;
  discarding: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const title = draft.title.trim() || "Untitled draft";

  return (
    <>
      <ShelfCard dashed>
        <Link
          href={`/novels/drafts/${draft.id}`}
          className="absolute inset-0 z-10"
          aria-label={`Continue draft: ${title}`}
        />

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.18em] text-caution uppercase">
              <RiQuillPenLine className="size-3 shrink-0" />
              Unfinished
            </p>
            <h2 className="mt-1.5 font-heading text-lg leading-snug font-semibold tracking-tight">
              {title}
            </h2>
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Discard draft: ${title}`}
            disabled={discarding}
            className="relative z-20 -mt-1 -mr-1 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/shelf-card:opacity-100"
            onClick={(event) => {
              event.preventDefault();
              setConfirming(true);
            }}
          >
            <RiCloseLine className="size-4" />
          </Button>
        </div>

        <p className="mt-3 mb-4 line-clamp-3 text-sm/6 text-muted-foreground">
          {draft.description.trim() ||
            "Nothing described yet — the wizard is holding your place."}
        </p>

        <ShelfCardColophon>
          {/* Four ticks rather than a bar: the wizard has exactly four steps,
              and a countable thing should be counted. */}
          <span className="flex items-center gap-2">
            <span className="flex gap-0.5" aria-hidden>
              {Array.from({ length: STEPS }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1 w-4",
                    index <= draft.step ? "bg-caution" : "bg-border",
                  )}
                />
              ))}
            </span>
            <span className="tabular-nums">
              Step {Math.min(draft.step + 1, STEPS)} of {STEPS}
            </span>
          </span>
          <span className="shrink-0 tabular-nums">
            {shortDate.format(new Date(draft.updatedAt))}
          </span>
        </ShelfCardColophon>
      </ShelfCard>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard “{title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The description and everything the AI read from it are discarded.
              No novel was created yet, so nothing else is affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onDiscard();
              }}
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
