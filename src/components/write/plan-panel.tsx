"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, PenLine, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Beat, Chapter } from "@/db/schema";

type Props = {
  novelId: string;
  chapterId: string;
  chapter: Chapter;
  selection: {
    characterIds: Set<string>;
    locationIds: Set<string>;
    elementIds: Set<string>;
  };
  instruction: string;
  disabled: boolean;
  onChapterUpdate: (chapter: Chapter) => void;
  /** Generates prose for a single beat and appends it to the draft. */
  onWriteBeat: (beat: Beat) => void;
};

/**
 * Plans a chapter before it is written. Beats feed straight into the writing
 * prompt, so the author steers structure instead of re-rolling whole chapters.
 */
export function PlanPanel({
  novelId,
  chapterId,
  chapter,
  selection,
  instruction,
  disabled,
  onChapterUpdate,
  onWriteBeat,
}: Props) {
  const [outline, setOutline] = useState(chapter.outline);
  const [beats, setBeats] = useState<Beat[]>(chapter.beats);
  const [planning, setPlanning] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOutline(chapter.outline);
    setBeats(chapter.beats);
  }, [chapter.id, chapter.outline, chapter.beats]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function persist(next: { outline?: string; beats?: Beat[] }) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await api.patch<Chapter>(
          `/api/entities/chapters/${chapterId}`,
          next,
        );
        onChapterUpdate(updated);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }, 800);
  }

  function updateOutline(value: string) {
    setOutline(value);
    persist({ outline: value });
  }

  function updateBeats(next: Beat[]) {
    setBeats(next);
    persist({ beats: next });
  }

  async function planWithAI() {
    setPlanning(true);
    try {
      const out = await api.post<{
        title: string;
        outline: string;
        beats: string[];
      }>("/api/ai/outline", {
        novelId,
        chapterId,
        instruction: instruction || undefined,
        selectedCharacterIds: [...selection.characterIds],
        selectedLocationIds: [...selection.locationIds],
        selectedElementIds: [...selection.elementIds],
      });
      const nextBeats: Beat[] = out.beats.map((text) => ({
        id: crypto.randomUUID(),
        text,
        done: false,
      }));
      setOutline(out.outline);
      setBeats(nextBeats);
      // Only adopt the suggested title if the chapter is still unnamed.
      const generic = /^chapter \d+$/i.test(chapter.title.trim());
      const updated = await api.patch<Chapter>(
        `/api/entities/chapters/${chapterId}`,
        {
          outline: out.outline,
          beats: nextBeats,
          ...(generic ? { title: out.title } : {}),
        },
      );
      onChapterUpdate(updated);
      toast.success("Chapter planned — edit the beats, then write them");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlanning(false);
    }
  }

  const nextUnwritten = beats.find((b) => !b.done);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <h3 className="text-sm font-semibold">Chapter plan</h3>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Beats are sent to the AI with every generation. Writing one beat at a
          time gives far more control than generating a whole chapter blind.
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={planWithAI}
          disabled={planning || disabled}
        >
          {planning ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Planning...
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              {beats.length ? "Re-plan chapter" : "Plan with AI"}
            </>
          )}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              What this chapter is for
            </h4>
            <Textarea
              rows={3}
              value={outline}
              onChange={(e) => updateOutline(e.target.value)}
              placeholder="Two or three sentences on the job this chapter does."
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Beats ({beats.filter((b) => b.done).length}/{beats.length})
              </h4>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[11px]"
                onClick={() =>
                  updateBeats([
                    ...beats,
                    { id: crypto.randomUUID(), text: "", done: false },
                  ])
                }
              >
                <Plus className="size-3" /> Add
              </Button>
            </div>

            {beats.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No beats yet. Plan the chapter, or add them yourself.
              </p>
            ) : (
              <div className="space-y-1.5">
                {beats.map((beat, i) => (
                  <div
                    key={beat.id}
                    className={cn(
                      "group rounded-md border p-2 transition-colors",
                      beat.done
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-border bg-card/40",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        title={beat.done ? "Mark as unwritten" : "Mark as written"}
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                          beat.done
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-muted-foreground",
                        )}
                        onClick={() =>
                          updateBeats(
                            beats.map((b) =>
                              b.id === beat.id ? { ...b, done: !b.done } : b,
                            ),
                          )
                        }
                      >
                        {beat.done && <Check className="size-3" />}
                      </button>
                      <Textarea
                        rows={2}
                        value={beat.text}
                        placeholder={`Beat ${i + 1}`}
                        className="min-h-0 resize-none border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
                        onChange={(e) =>
                          updateBeats(
                            beats.map((b) =>
                              b.id === beat.id
                                ? { ...b, text: e.target.value }
                                : b,
                            ),
                          )
                        }
                      />
                      <button
                        className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        onClick={() =>
                          updateBeats(beats.filter((b) => b.id !== beat.id))
                        }
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                    {!beat.done && beat.text.trim() && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1.5 h-6 w-full px-1.5 text-[11px]"
                        disabled={disabled}
                        onClick={() => onWriteBeat(beat)}
                      >
                        <PenLine className="size-3" /> Write this beat
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {nextUnwritten && (
        <div className="border-t p-3">
          <Button
            size="sm"
            className="w-full"
            disabled={disabled || !nextUnwritten.text.trim()}
            onClick={() => onWriteBeat(nextUnwritten)}
          >
            <PenLine className="size-4" /> Write next beat
          </Button>
        </div>
      )}
    </div>
  );
}
