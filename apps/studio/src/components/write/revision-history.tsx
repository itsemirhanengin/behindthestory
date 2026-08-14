"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  RiHistoryLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSaveLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { fetchEntity } from "@/lib/queries/entities";
import { useRevisions, useSaveRevision } from "@/lib/queries/chapters";
import { cn } from "@/lib/utils";
import type { ChapterRevision } from "@/lib/queries/types";

type RevisionSummary = Pick<
  ChapterRevision,
  "id" | "label" | "wordCount" | "createdAt"
>;

type Props = {
  chapterId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Content to snapshot before restoring, so a restore is itself undoable. */
  currentContent: () => string;
  onRestore: (content: string) => void;
};

function timeLabel(value: Date | string) {
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RevisionHistory({
  chapterId,
  open,
  onOpenChange,
  currentContent,
  onRestore,
}: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const saveRevision = useSaveRevision(chapterId);
  // Only while the dialog is open — history is not chrome.
  const { data, isError, refetch } = useRevisions(chapterId, { enabled: open });
  const revisions: RevisionSummary[] | null =
    data === undefined && !isError ? null : (data ?? []);

  const load = useCallback(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function showPreview(id: string) {
    setPreviewId(id);
    setPreview("");
    try {
      const row = await fetchEntity<ChapterRevision>("chapter-revisions", id);
      setPreview(row.content);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function restore(id: string) {
    setBusy(true);
    try {
      const row = await fetchEntity<ChapterRevision>("chapter-revisions", id);
      // Snapshot what is on screen first, otherwise restoring destroys it.
      await saveRevision
        .mutateAsync({ label: "before restore", content: currentContent() })
        .catch(() => {});
      onRestore(row.content);
      toast.success("Revision restored — the previous text was saved first");
      onOpenChange(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[520px] flex-col gap-0 sm:max-w-[520px]">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <RiHistoryLine className="size-4 text-primary" /> Revision history
          </SheetTitle>
          <SheetDescription>
            A snapshot is taken automatically before every AI write, so nothing
            the AI produces is destructive.
          </SheetDescription>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2 w-fit"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await saveRevision.mutateAsync({
                  label: "manual",
                  content: currentContent(),
                });
                toast.success(
                  "unchanged" in result && result.unchanged
                    ? "Already snapshotted — nothing has changed since."
                    : "Version saved",
                );
                load();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RiSaveLine className="size-4" /> Save current version
          </Button>
        </SheetHeader>

        <div className="flex min-h-0 flex-1">
          <ScrollArea className="w-56 shrink-0 border-r">
            <div className="space-y-1 p-2">
              {revisions === null ? (
                <div className="p-3 text-xs text-muted-foreground">
                  Loading...
                </div>
              ) : revisions.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  No snapshots yet.
                </div>
              ) : (
                revisions.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => showPreview(r.id)}
                    className={cn(
                      "w-full rounded-md border p-2 text-left transition-colors",
                      previewId === r.id
                        ? "border-primary/60 bg-primary/10"
                        : "border-transparent hover:bg-accent",
                    )}
                  >
                    <Badge variant="outline" className="text-[9px]">
                      {r.label}
                    </Badge>
                    <p className="mt-1 text-xs font-medium">
                      {timeLabel(r.createdAt)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.wordCount} words
                    </p>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          <div className="flex min-w-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              {previewId ? (
                <p className="manuscript whitespace-pre-wrap p-4 text-[13px]">
                  {preview || "Loading..."}
                </p>
              ) : (
                <p className="p-4 text-xs text-muted-foreground">
                  Select a snapshot to preview it.
                </p>
              )}
            </ScrollArea>
            {previewId && (
              <div className="border-t p-3">
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => restore(previewId)}
                >
                  {busy ? (
                    <RiLoader4Line className="size-4 animate-spin" />
                  ) : (
                    <RiRefreshLine className="size-4" />
                  )}
                  Restore this version
                </Button>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
