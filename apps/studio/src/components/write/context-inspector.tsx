"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiDatabase2Line, RiEyeLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type ContextSection = {
  key: string;
  title: string;
  tokens: number;
  included: number;
  omitted: number;
};

export type BuiltContext = {
  text: string;
  tokenEstimate: number;
  budget: number;
  sections: ContextSection[];
  retrievedCount: number;
};

type IndexStatus = { chunks: number; indexedAt: string | null };

type Props = {
  novelId: string;
  chapterId: string;
  selection: {
    characterIds: Set<string>;
    locationIds: Set<string>;
    elementIds: Set<string>;
  };
  /** Mirrors what a generation would send, so the preview is honest. */
  instruction?: string;
  draftTail?: () => string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Shows the exact prompt context the model will receive. The whole point is
 * that "does the AI know about X?" becomes a thing you can check, not guess.
 */
export function ContextInspector({
  novelId,
  chapterId,
  selection,
  instruction,
  draftTail,
  open,
  onOpenChange,
}: Props) {
  const [context, setContext] = useState<BuiltContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexing, setIndexing] = useState(false);

  const characterIds = [...selection.characterIds].join(",");
  const locationIds = [...selection.locationIds].join(",");
  const elementIds = [...selection.elementIds].join(",");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const built = await api.post<BuiltContext>("/api/ai/context", {
        novelId,
        chapterId,
        selectedCharacterIds: characterIds ? characterIds.split(",") : [],
        selectedLocationIds: locationIds ? locationIds.split(",") : [],
        selectedElementIds: elementIds ? elementIds.split(",") : [],
        instruction: instruction || undefined,
        draftTail: draftTail?.().slice(-8000) || undefined,
      });
      setContext(built);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
    api
      .get<IndexStatus>(`/api/chapters/${chapterId}/index`)
      .then(setIndexStatus)
      .catch(() => setIndexStatus(null));
    // `instruction`/`draftTail` are read at call time and must not retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, chapterId, characterIds, locationIds, elementIds]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [open, load]);

  async function reindex() {
    setIndexing(true);
    try {
      const result = await api.post<{ chunks: number }>(
        `/api/chapters/${chapterId}/index`,
      );
      toast.success(
        result.chunks
          ? `Indexed ${result.chunks} passage(s) from this chapter`
          : "Nothing to index — this chapter is empty",
      );
      const status = await api.get<IndexStatus>(
        `/api/chapters/${chapterId}/index`,
      );
      setIndexStatus(status);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIndexing(false);
    }
  }

  const usedPct = context
    ? Math.min(100, Math.round((context.tokenEstimate / context.budget) * 100))
    : 0;
  const totalOmitted =
    context?.sections.reduce((sum, s) => sum + s.omitted, 0) ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[640px] flex-col gap-0 sm:max-w-[640px]">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <RiEyeLine className="size-4 text-primary" /> What the AI sees
          </SheetTitle>
          <SheetDescription>
            The compiled context for your current selection, exactly as the
            model receives it.
          </SheetDescription>
        </SheetHeader>

        {loading && !context ? (
          <div className="flex flex-1 items-center justify-center">
            <RiLoader4Line className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !context ? null : (
          <Tabs defaultValue="breakdown" className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-3 border-b p-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">
                  ~{context.tokenEstimate.toLocaleString()} tokens
                </span>
                <span className="text-xs text-muted-foreground">
                  of {context.budget.toLocaleString()} budget
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-none bg-muted">
                <div
                  className={cn(
                    "h-full rounded-none transition-all",
                    usedPct > 90 ? "bg-caution" : "bg-primary",
                  )}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              {totalOmitted > 0 && (
                <p className="text-[11px] text-caution">
                  {totalOmitted} item(s) were left out to stay within budget.
                  Select what matters for this scene to pull it back in.
                </p>
              )}

              <div className="flex items-center justify-between gap-3 rounded-md border bg-card/50 px-3 py-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <RiDatabase2Line className="size-3 text-primary" /> Canon retrieval
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {context.retrievedCount > 0
                      ? `${context.retrievedCount} passage(s) pulled from earlier chapters.`
                      : "No earlier passages matched. Index chapters to make their prose retrievable."}
                    {indexStatus
                      ? ` This chapter: ${indexStatus.chunks} indexed.`
                      : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  disabled={indexing}
                  onClick={reindex}
                >
                  {indexing ? (
                    <RiLoader4Line className="size-4 animate-spin" />
                  ) : null}
                  Index
                </Button>
              </div>
            </div>

            <TabsList className="mx-4 mt-3">
              <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
              <TabsTrigger value="raw">Raw prompt</TabsTrigger>
            </TabsList>

            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="breakdown" className="space-y-1.5 p-4">
                {context.sections.map((s) => (
                  <div
                    key={s.key}
                    className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2 text-xs"
                  >
                    <span className="font-medium">{s.title}</span>
                    <span className="flex items-center gap-3 text-muted-foreground">
                      <span>{s.included} in</span>
                      {s.omitted > 0 && (
                        <span className="text-caution">
                          {s.omitted} omitted
                        </span>
                      )}
                      <span className="tabular-nums">
                        ~{s.tokens.toLocaleString()}t
                      </span>
                    </span>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="raw" className="p-4">
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {context.text}
                </pre>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
