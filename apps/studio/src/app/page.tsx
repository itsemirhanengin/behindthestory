"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RiAddLine, RiBookOpenLine, RiDeleteBinLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountMenu } from "@/components/account-menu";
import { api } from "@/lib/api";
import type { Novel } from "@/db/schema";

export default function HomePage() {
  const [novels, setNovels] = useState<Novel[] | null>(null);

  useEffect(() => {
    api
      .get<Novel[]>("/api/novels")
      .then(setNovels)
      .catch((e) => {
        toast.error(e.message);
        setNovels([]);
      });
  }, []);

  async function deleteNovel(id: string) {
    try {
      await api.del(`/api/novels/${id}`);
      setNovels((n) => (n ?? []).filter((x) => x.id !== id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <div className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-3 font-heading text-3xl font-semibold tracking-tight">
            <RiBookOpenLine className="size-8 text-primary" /> BehindTheStory
          </h1>
          <p className="mt-2 text-muted-foreground">
            Your AI-assisted novel writing studio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AccountMenu />
          <ThemeToggle />
          <Button asChild>
            <Link href="/novels/new">
              <RiAddLine className="size-4" /> New Novel
            </Link>
          </Button>
        </div>
      </div>

      {novels === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : novels.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-muted-foreground">
              No novels yet. The first step is describing one — the AI takes it
              from there.
            </p>
            <Button asChild variant="secondary">
              <Link href="/novels/new">
                <RiAddLine className="size-4" /> Start your first novel
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {novels.map((novel) => (
            <Card key={novel.id} className="group relative transition-colors hover:border-primary/50">
              <Link
                href={`/novels/${novel.id}/bible`}
                className="absolute inset-0 z-10"
                aria-label={novel.title}
              />
              <CardHeader>
                <CardTitle>{novel.title}</CardTitle>
                <CardDescription className="line-clamp-3">
                  {novel.premise || "No premise yet."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {new Date(novel.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative z-20 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    deleteNovel(novel.id);
                  }}
                >
                  <RiDeleteBinLine className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
