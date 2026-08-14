"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  RiArrowLeftLine,
  RiBookMarkedLine,
  RiBookOpenLine,
  RiBookReadLine,
  RiMapPinLine,
  RiMenuLine,
  RiMindMap,
  RiRouteLine,
  RiSideBarLine,
  RiSparkling2Line,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { ManuscriptSearch } from "@/components/manuscript-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { useNovelWorkspace } from "@/components/novel-workspace";
import type { Chapter, Novel } from "@/db/schema";

const sections = [
  { slug: "bible", label: "Story Bible", icon: RiBookMarkedLine },
  { slug: "characters", label: "Characters", icon: RiMindMap },
  { slug: "locations", label: "Locations", icon: RiMapPinLine },
  { slug: "story", label: "Story Map", icon: RiRouteLine },
  { slug: "read", label: "Read", icon: RiBookReadLine },
];

function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function NovelSidebar({ novelId }: { novelId: string }) {
  const pathname = usePathname();
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const {
    sidebarOpen,
    mobileNavigationOpen,
    setMobileNavigationOpen,
    toggleSidebar,
  } = useNovelWorkspace();
  const writingRoute = pathname.includes("/write/");
  const showDesktopSidebar = !writingRoute || sidebarOpen;

  useEffect(() => {
    api.get<Novel>(`/api/novels/${novelId}`).then(setNovel).catch(() => {});
  }, [novelId]);

  useEffect(() => {
    api
      .get<Chapter[]>(`/api/novels/${novelId}/chapters`)
      .then((rows) =>
        setChapters(
          rows.filter((chapter) => chapter.isActive).sort((a, b) => a.number - b.number),
        ),
      )
      .catch(() => {});
  }, [novelId, pathname]);

  const content = (
    <SidebarContent
      novelId={novelId}
      pathname={pathname}
      novel={novel}
      chapters={chapters}
      onNavigate={() => setMobileNavigationOpen(false)}
    />
  );

  return (
    <>
      <aside
        className={cn(
          "novel-sidebar hidden w-56 shrink-0 flex-col border-r bg-card/40 lg:flex",
          !showDesktopSidebar && "lg:hidden",
        )}
      >
        {content}
      </aside>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={cn(
          "fixed top-2 left-2 z-40 hidden lg:inline-flex",
          (!writingRoute || sidebarOpen) && "lg:hidden",
        )}
        onClick={toggleSidebar}
        aria-label="Show novel navigation"
      >
        <RiSideBarLine />
      </Button>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="fixed top-2 left-2 z-40 lg:hidden"
        onClick={() => setMobileNavigationOpen(true)}
        aria-label="Open novel navigation"
      >
        <RiMenuLine />
      </Button>

      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetContent
          side="left"
          className="w-[min(21rem,88vw)] gap-0 p-0 sm:max-w-sm"
        >
          <SheetTitle className="sr-only">Novel navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate the story bible, manuscript, and chapters.
          </SheetDescription>
          {content}
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarContent({
  novelId,
  pathname,
  novel,
  chapters,
  onNavigate,
}: {
  novelId: string;
  pathname: string;
  novel: Novel | null;
  chapters: Chapter[];
  onNavigate: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b p-4">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-1.5 text-sm/6 text-muted-foreground hover:text-foreground"
        >
          <RiArrowLeftLine className="size-4 shrink-0" /> All novels
        </Link>
        <div className="mt-3 flex items-start gap-2">
          <RiBookOpenLine className="size-4 shrink-0 stroke-primary" />
          <p className="line-clamp-2 min-w-0 text-base/6 font-medium sm:text-sm/5">
            {novel?.title ?? "Loading…"}
          </p>
        </div>
      </div>

      <div className="px-3 pt-3 pb-2">
        <ManuscriptSearch novelId={novelId} />
      </div>

      <nav className="space-y-1 px-3 pb-3" aria-label="Novel sections">
        {sections.map(({ slug, label, icon: Icon }) => {
          const href = `/novels/${novelId}/${slug}`;
          const active = pathname.startsWith(href);
          return (
            <Link
              key={slug}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-base/6 font-medium sm:text-sm/5",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 border-t">
        <p className="label-caps px-4 pt-3 pb-1">Chapters</p>
        <ScrollArea className="h-full">
          <div className="space-y-0.5 px-2 pb-4">
            {chapters.length === 0 ? (
              <p className="px-2 text-base/7 text-muted-foreground sm:text-sm/6">
                No chapters yet.
              </p>
            ) : (
              chapters.map((chapter) => {
                const active = pathname.endsWith(`/write/${chapter.id}`);
                return (
                  <Link
                    key={chapter.id}
                    href={`/novels/${novelId}/write/${chapter.id}`}
                    onClick={onNavigate}
                    className={cn(
                      "flex min-w-0 flex-col rounded-lg px-2 py-2",
                      active ? "bg-primary/10 text-primary" : "hover:bg-accent",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {chapter.number}
                      </span>
                      <span className="line-clamp-1 min-w-0 font-medium">
                        {chapter.title}
                      </span>
                    </div>
                    <p className="pl-4 tabular-nums text-muted-foreground">
                      {words(chapter.content).toLocaleString()} words
                    </p>
                  </Link>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <RiSparkling2Line className="size-4 shrink-0 stroke-primary" /> Assisted writing
        </p>
        <ThemeToggle />
      </div>
    </div>
  );
}
