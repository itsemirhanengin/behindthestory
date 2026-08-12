"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, TriangleAlert, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChapterCard, type Slot } from "./chapter-card";
import { ThreadTrack, type ThreadSpan } from "./thread-track";
import type { Chapter, Character, StoryElement } from "@/db/schema";

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
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [elements, setElements] = useState<StoryElement[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [chaps, elems, chars] = await Promise.all([
        api.get<Chapter[]>(`/api/novels/${novelId}/chapters`),
        api.get<StoryElement[]>(`/api/novels/${novelId}/story-elements`),
        api.get<Character[]>(`/api/novels/${novelId}/characters`),
      ]);
      setChapters(chaps);
      setElements(elems);
      setCharacters(chars);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
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
      const created = await api.post<Chapter>(
        `/api/novels/${novelId}/add-chapter`,
        afterNumber ? { afterNumber } : {},
      );
      await load();
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
          <Waypoints className="size-4 text-primary" /> Story Map
        </div>
        <span className="text-xs text-muted-foreground">
          {slots.length} chapter{slots.length === 1 ? "" : "s"} ·{" "}
          {totalWords.toLocaleString()} words
        </span>
        {openThreads.length > 0 && (
          <button
            onClick={() =>
              setSelectedThread(
                selectedThread ? null : openThreads[0].element.id,
              )
            }
            className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-500 transition-colors hover:bg-amber-500/20"
            title="Threads planted but never paid off"
          >
            <TriangleAlert className="size-3" />
            {openThreads.length} open thread
            {openThreads.length === 1 ? "" : "s"}
          </button>
        )}
        <Button size="sm" className="ml-auto" onClick={() => addChapter()}>
          <Plus className="size-4" />
          {slots.length === 0 ? "First chapter" : "Add chapter"}
        </Button>
      </div>

      {loading ? null : slots.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            The story starts here. Create your first chapter — threads the AI
            extracts will appear as tracks beneath the spine as the novel grows.
          </p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="w-fit p-5">
            {/*
              One grid for the whole map: column 1 is the thread label gutter
              and columns 2..N+1 are the chapter slots. Sharing the grid is
              what guarantees a thread lines up with the chapters it spans.
            */}
            <div
              className="grid gap-x-3"
              style={{
                gridTemplateColumns: `14rem repeat(${columns}, var(--slot-w))`,
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
                      gridColumn: `${slot.number + 1} / span ${span}`,
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
                  style={{ gridRow: 2, gridColumn: slot.number + 1 }}
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
                      mutate(() => api.post(`/api/chapters/${v.id}/activate`))
                    }
                    onAddVariant={() =>
                      mutate(async () => {
                        const created = await api.post<Chapter>(
                          `/api/chapters/${slot.active.id}/variants`,
                        );
                        toast.success(
                          `Take ${created.variantLabel} created — switch to it when you want it to count`,
                        );
                      })
                    }
                    onToggleContinues={() =>
                      mutate(() =>
                        api.patch(`/api/entities/chapters/${slot.active.id}`, {
                          continuesFromPrevious:
                            !slot.active.continuesFromPrevious,
                        }),
                      )
                    }
                    onInsertAfter={() => addChapter(slot.number)}
                    onDelete={() =>
                      mutate(() =>
                        api.del(`/api/entities/chapters/${slot.active.id}`),
                      )
                    }
                  />
                </div>
              ))}

              {/* Row 3 — threads heading */}
              <div
                className="mb-2 mt-8 flex items-center gap-3 px-2"
                style={{ gridRow: 3, gridColumn: `1 / span ${columns + 1}` }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Threads
                </span>
                {selectedThread && (
                  <button
                    onClick={() => setSelectedThread(null)}
                    className="text-[10px] text-primary hover:underline"
                  >
                    clear
                  </button>
                )}
                {threads.length === 0 && (
                  <span className="text-[11px] normal-case tracking-normal text-muted-foreground">
                    Nothing tracked yet — analyze a written chapter and its
                    twists, foreshadowing and plot threads appear here.
                  </span>
                )}
              </div>

              {/* Rows 4+ — one track per thread */}
              {threads.map((span, i) => (
                <ThreadTrack
                  key={span.element.id}
                  span={span}
                  columns={columns}
                  row={4 + i}
                  selected={selectedThread === span.element.id}
                  onSelect={() =>
                    setSelectedThread(
                      selectedThread === span.element.id
                        ? null
                        : span.element.id,
                    )
                  }
                />
              ))}
            </div>

            <div className="mt-4">

              {selectedThread && (
                <div className="mt-3 max-w-2xl rounded-lg border bg-card/60 p-3">
                  {(() => {
                    const span = threads.find(
                      (t) => t.element.id === selectedThread,
                    );
                    if (!span) return null;
                    return (
                      <>
                        <p className="text-xs font-medium">
                          {span.element.title}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {span.element.description}
                        </p>
                        <p
                          className={cn(
                            "mt-2 text-[11px]",
                            span.to === null
                              ? "text-amber-500"
                              : "text-emerald-400",
                          )}
                        >
                          {span.to === null
                            ? `Planted in chapter ${span.from}, still unresolved.`
                            : `Planted in chapter ${span.from}, paid off in chapter ${span.to}.`}
                        </p>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </div>
  );
}
