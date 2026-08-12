"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { Novel } from "@/db/schema";

export default function HomePage() {
  const [novels, setNovels] = useState<Novel[] | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .get<Novel[]>("/api/novels")
      .then(setNovels)
      .catch((e) => {
        toast.error(e.message);
        setNovels([]);
      });
  }, []);

  async function createNovel() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const novel = await api.post<Novel>("/api/novels", { title, premise });
      setNovels((n) => [novel, ...(n ?? [])]);
      setOpen(false);
      setTitle("");
      setPremise("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

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
            <BookOpen className="size-8 text-primary" /> StoryForge
          </h1>
          <p className="mt-2 text-muted-foreground">
            Your AI-assisted novel writing studio.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New Novel
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Novel</DialogTitle>
              <DialogDescription>
                The premise anchors every AI generation for this novel — make
                it count.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="The Hollow Crown"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="premise">Premise</Label>
                <Textarea
                  id="premise"
                  rows={5}
                  value={premise}
                  onChange={(e) => setPremise(e.target.value)}
                  placeholder="A disgraced cartographer discovers the kingdom's maps have been lying about an entire province..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createNovel} disabled={creating || !title.trim()}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {novels === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : novels.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            No novels yet. Create your first one to start building your world.
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
                  <Trash2 className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
