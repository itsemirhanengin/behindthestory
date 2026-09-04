"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  RiAddLine,
  RiBookOpenLine,
  RiDeleteBinLine,
  RiQuillPenLine,
} from "@remixicon/react";
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
import { useDeleteNovel, useNovels } from "@/lib/queries/novels";
import {
  useCreateNovelDraft,
  useDeleteNovelDraft,
  useNovelDrafts,
  type NovelDraft,
} from "@/lib/queries/novel-drafts";

export default function HomePage() {
  const router = useRouter();
  const { data: novels, error } = useNovels();
  // The wizard's works in progress. They live on the account, not this
  // device, so someone who started on their phone must find them on this
  // shelf — a shelf that pretends to be empty reads as lost work.
  const { data: drafts } = useNovelDrafts();
  const remove = useDeleteNovel();
  const removeDraft = useDeleteNovelDraft();
  const createDraft = useCreateNovelDraft();

  function deleteNovel(id: string) {
    remove.mutate(id, {
      onError: (cause) => toast.error(cause.message),
    });
  }

  // "New novel" mints the draft row first and the wizard lives at its id —
  // that is what lets several half-described novels sit side by side.
  function startNovel() {
    createDraft.mutate(undefined, {
      onSuccess: (draft) => router.push(`/novels/drafts/${draft.id}`),
      onError: (cause) => toast.error(cause.message),
    });
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
          <Button onClick={startNovel} disabled={createDraft.isPending}>
            <RiAddLine className="size-4" /> New Novel
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            {error.message}
          </CardContent>
        </Card>
      ) : !novels ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : novels.length === 0 && !drafts?.length ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-muted-foreground">
              No novels yet. The first step is describing one — the AI takes it
              from there.
            </p>
            <Button
              variant="secondary"
              onClick={startNovel}
              disabled={createDraft.isPending}
            >
              <RiAddLine className="size-4" /> Start your first novel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {drafts?.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onDiscard={() =>
                removeDraft.mutate(draft.id, {
                  onError: (cause) => toast.error(cause.message),
                })
              }
            />
          ))}
          {novels.map((novel) => (
            <Card
              key={novel.id}
              className="group relative transition-colors hover:border-primary/50"
            >
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

/**
 * The unfinished novel, shelved beside the finished ones. Dashed where the
 * real cards are solid — the same visual grammar the empty state uses for
 * "not a book yet" — and it opens the wizard exactly where the author left it,
 * whichever device they left it on.
 */
function DraftCard({
  draft,
  onDiscard,
}: {
  draft: NovelDraft;
  onDiscard: () => void;
}) {
  return (
    <Card className="group relative border-dashed transition-colors hover:border-primary/50">
      <Link
        href={`/novels/drafts/${draft.id}`}
        className="absolute inset-0 z-10"
        aria-label={`Continue draft: ${draft.title.trim() || "Untitled"}`}
      />
      <CardHeader>
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-caution">
          <RiQuillPenLine className="size-3" />
          Draft — step {draft.step + 1} of 4
        </p>
        <CardTitle>{draft.title.trim() || "Untitled draft"}</CardTitle>
        <CardDescription className="line-clamp-3">
          {draft.description.trim() ||
            "Nothing written yet — the wizard is holding your place."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {new Date(draft.updatedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Discard draft"
          className="relative z-20 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.preventDefault();
            onDiscard();
          }}
        >
          <RiDeleteBinLine className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
