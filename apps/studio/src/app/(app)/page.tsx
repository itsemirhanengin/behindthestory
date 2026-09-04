"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiAddLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AppHeader } from "@/components/app-header";
import { DraftCard } from "@/components/shelf/draft-card";
import { NovelCard } from "@/components/shelf/novel-card";
import { useDeleteNovel, useNovels } from "@/lib/queries/novels";
import {
  useCreateNovelDraft,
  useDeleteNovelDraft,
  useNovelDrafts,
} from "@/lib/queries/novel-drafts";

export default function HomePage() {
  const router = useRouter();
  const { data: novels, error } = useNovels();
  // The wizard's works in progress. They live on the account, not this device,
  // so someone who started on their phone must find them on this shelf — a
  // shelf that pretends to be empty reads as lost work.
  const { data: drafts } = useNovelDrafts();
  const remove = useDeleteNovel();
  const removeDraft = useDeleteNovelDraft();
  const createDraft = useCreateNovelDraft();

  function startNovel() {
    createDraft.mutate(undefined, {
      onSuccess: (draft) => router.push(`/novels/drafts/${draft.id}`),
      onError: (cause) => toast.error(cause.message),
    });
  }

  const empty = novels?.length === 0 && !drafts?.length;

  return (
    <>
      <AppHeader
        title="Your novels"
        actions={
          // The rail already carries this above the fold on a desktop. Here it
          // stands in wherever the rail is a sheet the writer has to open.
          <Button
            size="sm"
            className="lg:hidden"
            onClick={startNovel}
            disabled={createDraft.isPending}
          >
            <RiAddLine className="size-4" />
            New
          </Button>
        }
      />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {error ? (
          <div className="border border-destructive/40 bg-destructive/5 p-6">
            <p className="font-medium text-destructive">
              Your shelf could not be loaded.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
          </div>
        ) : !novels ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        ) : empty ? (
          <EmptyShelf onStart={startNovel} starting={createDraft.isPending} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {/* Unfinished first: it is the one thing on this page the writer
                came back to continue. */}
            {drafts?.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                discarding={removeDraft.isPending}
                onDiscard={() =>
                  removeDraft.mutate(draft.id, {
                    onError: (cause) => toast.error(cause.message),
                  })
                }
              />
            ))}
            {novels.map((novel) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                deleting={remove.isPending}
                onDelete={() =>
                  remove.mutate(novel.id, {
                    onError: (cause) => toast.error(cause.message),
                  })
                }
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

/**
 * The first-run shelf. It teaches the one thing that decides whether the next
 * screen works: the AI is reading a description, not inventing a book, and a
 * thin description gets a thin reading.
 */
function EmptyShelf({
  onStart,
  starting,
}: {
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <div className="border border-dashed border-border px-6 py-16 text-center">
      <h2 className="font-heading text-xl font-semibold tracking-tight">
        Nothing on the shelf yet
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm/6 text-muted-foreground">
        Describe the novel you have in mind — a paragraph or two, the more the
        better. The AI reads it back to you as a premise, a protagonist and a
        conflict you can correct before any of it becomes canon.
      </p>
      <Button className="mt-6" onClick={onStart} disabled={starting}>
        <RiAddLine className="size-4" />
        {starting ? "Opening…" : "Describe your first novel"}
      </Button>
    </div>
  );
}
