"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiAddLine, RiAlertLine, RiRouteLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useDeleteEntity, useEntityList, useUpdateEntity } from "@/lib/queries/entities";
import { useAddChapter } from "@/lib/queries/story";
import { useActivateVariant, useCreateVariant } from "@/lib/queries/chapters";
import { cn } from "@/lib/utils";
import { ChapterCard, type Slot } from "./chapter-card";
import {
  ThreadBoard,
  countOverdue,
  type ThreadFilter,
  type ThreadSpan,
} from "./thread-board";
import type { Chapter, Character, StoryElement } from "@/lib/queries/types";

function buildSlots(chapters: Chapter[]): Slot[] {
  const byNumber = new Map<number, Chapter[]>();
  for (const ch of chapters) {
    byNumber.set(ch.number, [...(byNumber.get(ch.number) ?? []), ch]);
  }
  return [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, variants]) => {
      const sorted = [...variants].sort((a, b) =>
        a.variantLabel.localeCompare(b.variantLabel),
      );
      const active = sorted.find((c) => c.isActive) ?? sorted[0];
      return { number, act: active.act, active, variants: sorted };
    });
}

export function StoryMap({ novelId }: { novelId: string }) {
  const router = useRouter();
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [threadFilter, setThreadFilter] = useState<ThreadFilter>("all");

  const chaptersQuery = useEntityList<Chapter>(novelId, "chapters");
  const elementsQuery = useEntityList<StoryElement>(novelId, "story-elements");
  const charactersQuery = useEntityList<Character>(novelId, "characters");
  const chapters = chaptersQuery.data ?? [];
  const elements = elementsQuery.data ?? [];
  const characters = charactersQuery.data ?? [];
  const loading =
    chaptersQuery.isPending || elementsQuery.isPending || charactersQuery.isPending;

  const addChapterMutation = useAddChapter(novelId);
  const activateVariant = useActivateVariant(novelId);
  const createVariant = useCreateVariant(novelId);
  const updateEntity = useUpdateEntity<Chapter>(novelId);
  const deleteEntity = useDeleteEntity(novelId);

  const load = useCallback(async () => {
    await Promise.all([
      chaptersQuery.refetch(),
      elementsQuery.refetch(),
      charactersQuery.refetch(),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  useEffect(() => {
    load();
  }, [load]);

  const slots = useMemo(() => buildSlots(chapters), [chapters]);

  // Threads are positioned by meaning: the slot they were planted in and the
  // slot that pays them off. Nothing here is manually placed.
  const threads = useMemo<ThreadSpan[]>(() => {
    const slotOf = new Map<string, number>();
    for (const ch of chapters) slotOf.set(ch.id, ch.number);
    return elements
      .map((element) => {
        const from = element.introducedInChapterId
          ? slotOf.get(element.introducedInChapterId)
          : undefined;
        const to = element.resolvedInChapterId
          ? (slotOf.get(element.resolvedInChapterId) ?? null)
          : null;
        return { element, from: from ?? 1, to: element.status === "resolved" ? to : null };
      })
      .sort((a, b) => a.from - b.from || (a.to ?? 99) - (b.to ?? 99));
  }, [elements, chapters]);

  const openThreads = threads.filter((t) => t.to === null);

  /** Chapters touched by the selected thread, for the dim-everything-else view. */
  const threadSlots = useMemo(() => {
    if (!selectedThread) return null;
    const span = threads.find((t) => t.element.id === selectedThread);
    if (!span) return null;
    const end = span.to ?? slots.length;
    return new Set(
      Array.from({ length: end - span.from + 1 }, (_, i) => span.from + i),
    );
  }, [selectedThread, threads, slots.length]);

  async function addChapter(afterNumber?: number) {
    try {
      const created = await addChapterMutation.mutateAsync(
        afterNumber ? { afterNumber } : {},
      );
      router.push(`/novels/${novelId}/write/${created.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function mutate(action: () => Promise<unknown>) {
    try {
      await action();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const columns = Math.max(slots.length, 1);
  // The draft's written edge. A thread cannot be overdue in chapters that are
  // still empty, so this — not the outline length — is what ages a thread.
  const writtenThrough = slots.reduce(
    (last, s) => (s.active.content.trim() ? s.number : last),
    0,
  );
  const overdue = countOverdue(threads, writtenThrough);
  const totalWords = slots.reduce(
    (sum, s) =>
      sum + (s.active.content.trim() ? s.active.content.trim().split(/\s+/).length : 0),
    0,
  );

  return (
    <div
      className="flex h-full flex-col"
      style={{ "--slot-w": "13rem" } as React.CSSProperties}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <RiRouteLine className="size-4 text-primary" /> Story Map
        </div>
        <span className="text-xs text-muted-foreground">
          {slots.length} chapter{slots.length === 1 ? "" : "s"} ·{" "}
          {totalWords.toLocaleString()} words
        </span>
        {/*
          An open thread is only a warning once the draft has run past it —
          otherwise every setup in a young manuscript would shout, and the
          badge would stop meaning anything.
        */}
        {openThreads.length > 0 && (
          <button
            onClick={() => setThreadFilter("open")}
            className={cn(
              "flex items-center gap-1.5 rounded-none px-2.5 py-1 text-[11px] transition-colors",
              overdue > 0
                ? "bg-caution/10 text-caution hover:bg-caution/20"
                : "text-muted-foreground hover:bg-accent",
            )}
            title={
              overdue > 0
                ? "Threads the draft has moved well past without paying off"
                : "Threads planted but not yet paid off"
            }
          >
            {overdue > 0 && <RiAlertLine className="size-3" />}
            {overdue > 0
              ? `${overdue} overdue`
              : `${openThreads.length} open thread${openThreads.length === 1 ? "" : "s"}`}
          </button>
        )}
        <Button size="sm" className="ml-auto" onClick={() => addChapter()}>
          <RiAddLine className="size-4" />
          {slots.length === 0 ? "First chapter" : "Add chapter"}
        </Button>
      </div>

      {loading ? null : slots.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            The story starts here. Create your first chapter — threads the AI
            extracts will appear beneath the spine as the novel grows.
          </p>
        </div>
      ) : (
        <>
          {/*
            The spine scrolls horizontally on its own. Threads used to live in
            this same grid so their bars could line up with the chapters — they
            no longer need to, so they no longer pay the price of scrolling out
            of view whenever the writer looks at a later chapter.
          */}
          <ScrollArea className="shrink-0">
            <div className="w-fit px-5 pb-4 pt-5">
            <div
              className="grid gap-x-3"
              style={{
                gridTemplateColumns: `repeat(${columns}, var(--slot-w))`,
              }}
            >
              {/* Row 1 — acts */}
              {slots.map((slot, i) => {
                const isActStart = i === 0 || slots[i - 1].act !== slot.act;
                if (!isActStart) return null;
                const span = slots.filter((s) => s.act === slot.act).length;
                return (
                  <div
                    key={`act-${slot.number}`}
                    className="mb-2 flex items-center gap-2"
                    style={{
                      gridRow: 1,
                      gridColumn: `${slot.number} / span ${span}`,
                    }}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Act {slot.act}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                );
              })}

              {/* Row 2 — the spine */}
              {slots.map((slot) => (
                <div
                  key={slot.number}
                  style={{ gridRow: 2, gridColumn: slot.number }}
                >
                  <ChapterCard
                    slot={slot}
                    novelId={novelId}
                    cast={characters.filter(
                      (c) =>
                        slot.active.content.includes(c.name) ||
                        slot.active.summary.includes(c.name),
                    )}
                    highlighted={threadSlots?.has(slot.number) ?? false}
                    dimmed={!!threadSlots && !threadSlots.has(slot.number)}
                    onActivateVariant={(v) =>
                      mutate(() => activateVariant.mutateAsync(v.id))
                    }
                    onAddVariant={() =>
                      mutate(async () => {
                        const created = await createVariant.mutateAsync(
                          slot.active.id,
                        );
                        toast.success(
                          `Take ${created.variantLabel} created — switch to it when you want it to count`,
                        );
                      })
                    }
                    onToggleContinues={() =>
                      mutate(() =>
                        updateEntity.mutateAsync({
                          entity: "chapters",
                          id: slot.active.id,
                          values: {
                            continuesFromPrevious:
                              !slot.active.continuesFromPrevious,
                          },
                        }),
                      )
                    }
                    onInsertAfter={() => addChapter(slot.number)}
                    onDelete={() =>
                      mutate(() =>
                        deleteEntity.mutateAsync({
                          entity: "chapters",
                          id: slot.active.id,
                        }),
                      )
                    }
                  />
                </div>
              ))}

            </div>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          <div className="min-h-0 flex-1 border-t">
            <ThreadBoard
              threads={threads}
              chapterCount={columns}
              writtenThrough={writtenThrough}
              filter={threadFilter}
              onFilterChange={setThreadFilter}
              selected={selectedThread}
              onSelect={setSelectedThread}
            />
          </div>
        </>
      )}
    </div>
  );
}
