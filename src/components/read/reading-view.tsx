"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { MarkdownProse } from "./markdown-prose";
import type { Chapter, Novel } from "@/db/schema";

export function ReadingView({ novelId }: { novelId: string }) {
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Novel>(`/api/novels/${novelId}`),
      api.get<Chapter[]>(`/api/novels/${novelId}/chapters`),
    ])
      .then(([n, chaps]) => {
        setNovel(n);
        // Only the active take of each slot is part of the manuscript.
        setChapters(
          chaps.filter((c) => c.isActive).sort((a, b) => a.number - b.number),
        );
      })
      .catch((e) => {
        toast.error((e as Error).message);
        setChapters([]);
      });
  }, [novelId]);

  const written = useMemo(
    () => (chapters ?? []).filter((ch) => ch.content.trim()),
    [chapters],
  );
  const totalWords = useMemo(
    () =>
      written.reduce(
        (sum, ch) => sum + (ch.content.trim().split(/\s+/).length || 0),
        0,
      ),
    [written],
  );

  if (!chapters) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 p-10">
        <Skeleton className="h-10" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto w-full max-w-2xl px-8 py-14">
        <header className="mb-14 border-b pb-8 text-center">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {novel?.title}
          </h1>
          {novel?.premise && (
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {novel.premise}
            </p>
          )}
          <div className="mt-5 flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <span>
              {written.length} chapter{written.length === 1 ? "" : "s"} ·{" "}
              {totalWords.toLocaleString()} words
            </span>
            <Button size="sm" variant="secondary" asChild>
              <a href={`/api/novels/${novelId}/export`} download>
                <Download className="size-4" /> Export Markdown
              </a>
            </Button>
          </div>
        </header>

        {written.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            Nothing written yet. Start a chapter on the Story Map.
          </p>
        ) : (
          written.map((ch) => (
            <section key={ch.id} className="mb-16">
              <div className="mb-6 text-center">
                <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
                  Chapter {ch.number}
                </p>
                <h2 className="mt-1 flex items-center justify-center gap-2 font-heading text-xl font-semibold">
                  {ch.title}
                  {ch.status === "draft" && (
                    <Badge variant="outline" className="text-[9px] uppercase">
                      draft
                    </Badge>
                  )}
                  <Link
                    href={`/novels/${novelId}/write/${ch.id}`}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    title="Edit this chapter"
                  >
                    <PenLine className="size-3.5" />
                  </Link>
                </h2>
              </div>
              <MarkdownProse markdown={ch.content} />
            </section>
          ))
        )}
      </div>
    </ScrollArea>
  );
}
