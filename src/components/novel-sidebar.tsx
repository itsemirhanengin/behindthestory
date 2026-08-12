"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  BookOpenText,
  MapPin,
  Network,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ManuscriptSearch } from "@/components/manuscript-search";
import type { Chapter, Novel } from "@/db/schema";

const sections = [
  { slug: "bible", label: "Story Bible", icon: BookMarked },
  { slug: "characters", label: "Characters", icon: Network },
  { slug: "locations", label: "Locations", icon: MapPin },
  { slug: "story", label: "Story Map", icon: Waypoints },
  { slug: "read", label: "Read", icon: BookOpenText },
];

function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function NovelSidebar({ novelId }: { novelId: string }) {
  const pathname = usePathname();
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    api.get<Novel>(`/api/novels/${novelId}`).then(setNovel).catch(() => {});
  }, [novelId]);

  // Re-read on navigation so a chapter created or renamed elsewhere shows up.
  useEffect(() => {
    api
      .get<Chapter[]>(`/api/novels/${novelId}/chapters`)
      .then((rows) =>
        setChapters(
          rows.filter((c) => c.isActive).sort((a, b) => a.number - b.number),
        ),
      )
      .catch(() => {});
  }, [novelId, pathname]);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-card/40">
      <div className="border-b p-4">
        <Link
          href="/"
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> All novels
        </Link>
        <div className="flex items-start gap-2">
          <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="line-clamp-2 text-sm font-semibold leading-tight">
            {novel?.title ?? "..."}
          </span>
        </div>
      </div>

      <div className="pt-3">
        <ManuscriptSearch novelId={novelId} />
      </div>

      <nav className="space-y-1 px-3 pb-3">
        {sections.map(({ slug, label, icon: Icon }) => {
          const href = `/novels/${novelId}/${slug}`;
          const active = pathname.startsWith(href);
          return (
            <Link
              key={slug}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 border-t">
        <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Chapters
        </p>
        <ScrollArea className="h-full">
          <div className="space-y-0.5 px-2 pb-4">
            {chapters.length === 0 ? (
              <p className="px-2 text-[11px] text-muted-foreground">
                None yet.
              </p>
            ) : (
              chapters.map((ch) => {
                const active = pathname.endsWith(`/write/${ch.id}`);
                return (
                  <Link
                    key={ch.id}
                    href={`/novels/${novelId}/write/${ch.id}`}
                    className={cn(
                      "block rounded-md px-2 py-1.5 transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-accent",
                    )}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {ch.number}
                      </span>
                      <span className="line-clamp-1 text-xs font-medium">
                        {ch.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 pl-4 text-[10px] text-muted-foreground">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          ch.status === "final"
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/40",
                        )}
                      />
                      {words(ch.content).toLocaleString()} words
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="border-t p-4 text-[11px] leading-relaxed text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <Sparkles className="size-3 text-primary" /> AI-assisted studio
        </p>
      </div>
    </aside>
  );
}
