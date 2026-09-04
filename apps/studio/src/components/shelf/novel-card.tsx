"use client";

import { useState } from "react";
import Link from "next/link";
import { RiDeleteBinLine } from "@remixicon/react";
import { povLabel, tenseLabel } from "@behindthestory/core/onboarding";

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
import { ShelfCard, ShelfCardColophon, ShelfCardMeta } from "@/components/shelf/shelf-card";
import type { Novel } from "@/lib/queries/types";

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * One novel on the shelf, set as a catalogue entry rather than a tile.
 *
 * The style profile is the card's own content: genre and tone are what the
 * author actually chose, and they are what tells two novels apart at a glance
 * far better than a second date would. Everything shown here is already on the
 * row the shelf loads, so the card costs no extra request.
 */
export function NovelCard({
  novel,
  onDelete,
  deleting,
}: {
  novel: Novel;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  const style = [novel.genre, novel.tone].filter((value) => value.trim());
  const narration = `${povLabel(novel.pov)} · ${tenseLabel(novel.tense)}`;

  return (
    <>
      <ShelfCard>
        <Link
          href={`/novels/${novel.id}/bible`}
          className="absolute inset-0 z-10"
          aria-label={novel.title}
        />

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-heading text-lg leading-snug font-semibold tracking-tight">
              {novel.title}
            </h2>
            {style.length > 0 ? (
              <ShelfCardMeta>{style.join(" · ")}</ShelfCardMeta>
            ) : null}
          </div>

          {/* Kept out of the flow so the title never reflows on hover, and
              revealed on focus as well as hover — otherwise it is unreachable
              by keyboard while still being in the tab order. */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${novel.title}`}
            disabled={deleting}
            className="relative z-20 -mt-1 -mr-1 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/shelf-card:opacity-100"
            onClick={(event) => {
              event.preventDefault();
              setConfirming(true);
            }}
          >
            <RiDeleteBinLine className="size-4" />
          </Button>
        </div>

        <p className="mt-3 mb-4 line-clamp-3 text-sm/6 text-muted-foreground">
          {novel.premise.trim() || "No premise yet."}
        </p>

        <ShelfCardColophon>
          <span className="truncate">{narration}</span>
          <span className="shrink-0 tabular-nums">
            {shortDate.format(new Date(novel.createdAt))}
          </span>
        </ShelfCardColophon>
      </ShelfCard>

      {/* Deleting a novel takes its chapters, bible and timeline with it, and
          nothing here restores them. One click was never the right weight. */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{novel.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Every chapter, character, location and timeline event in this
              novel is deleted with it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              Delete novel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
