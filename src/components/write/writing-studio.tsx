"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Eye,
  History,
  Loader2,
  PenLine,
  ScanSearch,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { consumeProseStream, type ProseUsage } from "@/lib/prose-stream";
import { ContextPanel, type ContextSelection } from "./context-panel";
import { AnalyzeDialog } from "./analyze-dialog";
import { ContextInspector } from "./context-inspector";
import { ContinuityPanel } from "./continuity-panel";
import { PlanPanel } from "./plan-panel";
import { RevisionHistory } from "./revision-history";
import {
  ProseEditor,
  type MentionItem,
  type ProseEditorHandle,
} from "./prose-editor";
import type {
  Beat,
  Chapter,
  Character,
  Location,
  Novel,
  Relationship,
  StoryElement,
  StoryEvent,
} from "@/db/schema";

const INLINE_ACTIONS = [
  { key: "rewrite", label: "Rewrite" },
  { key: "expand", label: "Expand" },
  { key: "shorten", label: "Tighten" },
  { key: "dialogue", label: "Dialogue" },
  { key: "describe", label: "Setting" },
] as const;

const AUTOSAVE_DELAY = 1200;

export function WritingStudio({
  novelId,
  chapterId,
}: {
  novelId: string;
  chapterId: string;
}) {
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [allChapters, setAllChapters] = useState<Chapter[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [elements, setElements] = useState<StoryElement[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [storyEvents, setStoryEvents] = useState<StoryEvent[]>([]);

  const [title, setTitle] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">(
    "saved",
  );
  const [selection, setSelection] = useState<ContextSelection>({
    characterIds: new Set(),
    locationIds: new Set(),
    elementIds: new Set(),
  });
  const [instruction, setInstruction] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [lastUsage, setLastUsage] = useState<ProseUsage | null>(null);
  const [panel, setPanel] = useState("context");
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const editorRef = useRef<ProseEditorHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncFrame = useRef<number | null>(null);
  const contentRef = useRef("");
  const titleRef = useRef("");
  const dirtyRef = useRef(false);

  // --- Loading ---------------------------------------------------------
  const loadAll = useCallback(async () => {
    const [nov, ch, chapters, chars, locs, elems, rels, evts] =
      await Promise.all([
        api.get<Novel>(`/api/novels/${novelId}`),
        api.get<Chapter>(`/api/entities/chapters/${chapterId}`),
        api.get<Chapter[]>(`/api/novels/${novelId}/chapters`),
        api.get<Character[]>(`/api/novels/${novelId}/characters`),
        api.get<Location[]>(`/api/novels/${novelId}/locations`),
        api.get<StoryElement[]>(`/api/novels/${novelId}/story-elements`),
        api.get<Relationship[]>(`/api/novels/${novelId}/relationships`),
        api.get<StoryEvent[]>(`/api/novels/${novelId}/story-events`),
      ]);
    chapters.sort((a, b) => a.number - b.number);
    setNovel(nov);
    setChapter(ch);
    setAllChapters(chapters);
    setCharacters(chars);
    setLocations(locs);
    setElements(elems);
    setRelationships(rels);
    setStoryEvents(evts);
    setTitle(ch.title);
    titleRef.current = ch.title;
    contentRef.current = ch.content;
    setWordCount(countWords(ch.content));
    setReady(true);
  }, [novelId, chapterId]);

  useEffect(() => {
    loadAll().catch((e) => toast.error(e.message));
  }, [loadAll]);

  // --- Saving ----------------------------------------------------------
  const persist = useCallback(async () => {
    setSaveState("saving");
    try {
      await api.patch(`/api/entities/chapters/${chapterId}`, {
        title: titleRef.current,
        content: contentRef.current,
      });
      dirtyRef.current = false;
      setSaveState("saved");
    } catch {
      setSaveState("dirty");
    }
  }, [chapterId]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, AUTOSAVE_DELAY);
  }, [persist]);

  /**
   * Serializing the whole document costs real time on a long chapter, so it
   * is coalesced to once per frame rather than once per keystroke.
   */
  const handleEditorChange = useCallback(() => {
    if (syncFrame.current !== null) return;
    syncFrame.current = requestAnimationFrame(() => {
      syncFrame.current = null;
      const markdown = editorRef.current?.getMarkdown() ?? "";
      contentRef.current = markdown;
      setWordCount(countWords(markdown));
      scheduleSave();
    });
  }, [scheduleSave]);

  // Flush on unmount. `keepalive` lets the request outlive the navigation,
  // which is exactly the case that used to silently drop the last edits.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (syncFrame.current !== null) cancelAnimationFrame(syncFrame.current);
      if (!dirtyRef.current) return;
      fetch(`/api/entities/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleRef.current,
          content: contentRef.current,
        }),
        keepalive: true,
      }).catch(() => {});
    };
  }, [chapterId]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || streaming) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [streaming]);

  function updateTitle(next: string) {
    setTitle(next);
    titleRef.current = next;
    scheduleSave();
  }

  // --- Context selection ------------------------------------------------
  const toggleSelection = useCallback(
    (
      kind: "character" | "location" | "element",
      id: string,
      forceOn = false,
    ) => {
      setSelection((s) => {
        const key =
          kind === "character"
            ? "characterIds"
            : kind === "location"
              ? "locationIds"
              : "elementIds";
        const next = new Set(s[key]);
        if (next.has(id) && !forceOn) next.delete(id);
        else next.add(id);
        return { ...s, [key]: next };
      });
    },
    [],
  );

  const mentionSource = useCallback(
    (): MentionItem[] => [
      ...characters.map((c) => ({
        kind: "character" as const,
        id: c.id,
        label: c.name,
      })),
      ...locations.map((l) => ({
        kind: "location" as const,
        id: l.id,
        label: l.name,
      })),
      ...elements.map((e) => ({
        kind: "element" as const,
        id: e.id,
        label: e.title,
      })),
    ],
    [characters, locations, elements],
  );

  const onMention = useCallback(
    (item: MentionItem) => toggleSelection(item.kind, item.id, true),
    [toggleSelection],
  );

  // --- Generation -------------------------------------------------------
  const snapshot = useCallback(
    (label: string) =>
      api
        .post(`/api/chapters/${chapterId}/revisions`, {
          label,
          content: contentRef.current,
        })
        .catch(() => {}),
    [chapterId],
  );

  async function runStream(
    url: string,
    body: unknown,
    mode: "append" | "replace",
    snapshotLabel: string,
  ) {
    const editor = editorRef.current;
    if (!editor || streaming) return;

    if (contentRef.current.trim()) await snapshot(snapshotLabel);

    setStreaming(true);
    setLastUsage(null);
    const controller = new AbortController();
    abortRef.current = controller;

    if (mode === "append") editor.beginAppendStream();
    else editor.beginReplaceStream();

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      await consumeProseStream(res, {
        onDelta: (text) => editor.pushStreamDelta(text),
        onUsage: setLastUsage,
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error((e as Error).message);
      }
    } finally {
      editor.endStream();
      setStreaming(false);
      abortRef.current = null;
      handleEditorChange();
    }
  }

  function writeWithAI() {
    if (!chapter) return;
    return runStream(
      "/api/ai/chapter",
      {
        novelId,
        chapterId,
        instruction: instruction || undefined,
        selectedCharacterIds: [...selection.characterIds],
        selectedLocationIds: [...selection.locationIds],
        selectedElementIds: [...selection.elementIds],
        existingContent: contentRef.current,
      },
      "append",
      "before AI draft",
    );
  }

  async function writeBeat(beat: Beat) {
    if (!chapter) return;
    await runStream(
      "/api/ai/chapter",
      {
        novelId,
        chapterId,
        beatId: beat.id,
        instruction: instruction || undefined,
        selectedCharacterIds: [...selection.characterIds],
        selectedLocationIds: [...selection.locationIds],
        selectedElementIds: [...selection.elementIds],
        existingContent: contentRef.current,
      },
      "append",
      "before AI beat",
    );
    // Tick the beat off so "write next beat" advances through the plan.
    try {
      const updated = await api.patch<Chapter>(
        `/api/entities/chapters/${chapterId}`,
        {
          beats: chapter.beats.map((b) =>
            b.id === beat.id ? { ...b, done: true } : b,
          ),
        },
      );
      setChapter(updated);
    } catch {
      /* the prose is already in the editor; a failed tick is not worth a toast */
    }
  }

  function runInline(action: (typeof INLINE_ACTIONS)[number]["key"]) {
    const context = editorRef.current?.getSelectionContext();
    if (!context) {
      toast.error("Select a passage first.");
      return;
    }
    return runStream(
      "/api/ai/inline",
      {
        novelId,
        chapterId,
        action,
        selection: context.text,
        before: context.before,
        after: context.after,
        instruction: instruction || undefined,
        selectedCharacterIds: [...selection.characterIds],
        selectedLocationIds: [...selection.locationIds],
        selectedElementIds: [...selection.elementIds],
      },
      "replace",
      `before AI ${action}`,
    );
  }

  // --- Navigation -------------------------------------------------------
  // Navigation follows the spine — the active variant of the neighbouring
  // slots — not whichever row happens to sort next.
  const { prev, next } = useMemo(() => {
    if (!chapter) return { prev: null, next: null };
    const spine = allChapters.filter((c) => c.isActive);
    return {
      prev: spine.find((c) => c.number === chapter.number - 1) ?? null,
      next: spine.find((c) => c.number === chapter.number + 1) ?? null,
    };
  }, [allChapters, chapter]);

  const target = novel?.targetChapterWords ?? 0;
  const progress = target > 0 ? Math.min(100, (wordCount / target) * 100) : 0;

  if (!chapter || !ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Link
            href={`/novels/${novelId}/story`}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Story Map
          </Link>

          <div className="flex items-center">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={!prev}
              asChild={!!prev}
              title={prev ? `Chapter ${prev.number}: ${prev.title}` : undefined}
            >
              {prev ? (
                <Link href={`/novels/${novelId}/write/${prev.id}`}>
                  <ChevronLeft className="size-4" />
                </Link>
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              Ch. {chapter.number}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={!next}
              asChild={!!next}
              title={next ? `Chapter ${next.number}: ${next.title}` : undefined}
            >
              {next ? (
                <Link href={`/novels/${novelId}/write/${next.id}`}>
                  <ChevronRight className="size-4" />
                </Link>
              ) : (
                <ChevronRight className="size-4" />
              )}
            </Button>
          </div>

          <Input
            value={title}
            onChange={(e) => updateTitle(e.target.value)}
            className="h-8 max-w-xs border-transparent bg-transparent font-medium focus-visible:border-input"
          />
          <Select
            value={chapter.status}
            onValueChange={async (v) => {
              const updated = await api.patch<Chapter>(
                `/api/entities/chapters/${chapterId}`,
                { status: v },
              );
              setChapter(updated);
            }}
          >
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="final">Final</SelectItem>
            </SelectContent>
          </Select>

          {chapter.variantLabel && (
            <Tooltip>
              <TooltipTrigger asChild>
                {chapter.isActive ? (
                  <Badge variant="secondary" className="text-[10px]">
                    take {chapter.variantLabel}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-amber-500/50 text-[11px] text-amber-500"
                    onClick={async () => {
                      try {
                        const updated = await api.post<Chapter>(
                          `/api/chapters/${chapterId}/activate`,
                        );
                        setChapter(updated);
                        toast.success(
                          `Take ${updated.variantLabel} is now the one that counts`,
                        );
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    take {chapter.variantLabel} · inactive
                  </Button>
                )}
              </TooltipTrigger>
              <TooltipContent>
                {chapter.isActive
                  ? "This take is part of the manuscript."
                  : "This take is not in the manuscript — the reader, the export and the AI all see a different one. Click to switch."}
              </TooltipContent>
            </Tooltip>
          )}

          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{wordCount} words</span>
                  {target > 0 && (
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          "block h-full rounded-full transition-all",
                          progress >= 100 ? "bg-emerald-500" : "bg-primary",
                        )}
                        style={{ width: `${progress}%` }}
                      />
                    </span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {target > 0
                  ? `${wordCount} of ~${target} target words`
                  : "Set a target chapter length in the Story Bible"}
              </TooltipContent>
            </Tooltip>

            <Badge variant="outline" className="text-[10px]">
              {saveState === "saved"
                ? "Saved"
                : saveState === "saving"
                  ? "Saving..."
                  : "Unsaved"}
            </Badge>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setHistoryOpen(true)}
                >
                  <History className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Revision history</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setInspectorOpen(true)}
                >
                  <Eye className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>What the AI sees</TooltipContent>
            </Tooltip>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAnalyzeOpen(true)}
              disabled={!wordCount || streaming}
              title="Extract what this chapter established into the story bible"
            >
              <ScanSearch className="size-4" /> Analyze
            </Button>
            <Button
              size="sm"
              onClick={() => setPanel("issues")}
              disabled={!wordCount || streaming}
              title="Check this chapter against the story bible"
            >
              <ShieldAlert className="size-4" /> Check
            </Button>
          </div>
        </div>

        {/* Editor */}
        <ProseEditor
          ref={editorRef}
          initialMarkdown={chapter.content}
          editable={!streaming}
          placeholder={`Begin Chapter ${chapter.number}... or set the context on the right and let the AI draft it. Type @ to mention a character, place, or thread. Select a passage for inline AI edits.`}
          onChange={handleEditorChange}
          mentionSource={mentionSource}
          onMention={onMention}
          bubbleActions={
            <>
              {INLINE_ACTIONS.map((a) => (
                <Button
                  key={a.key}
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={streaming}
                  onClick={() => runInline(a.key)}
                >
                  {a.label}
                </Button>
              ))}
            </>
          }
        />

        {/* AI bar */}
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <Input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Direction for the AI, e.g. 'a tense confrontation at the docks, end on a cliffhanger'"
            className="h-9"
            disabled={streaming}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !streaming) writeWithAI();
            }}
          />
          {lastUsage && !streaming && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {lastUsage.inputTokens.toLocaleString()} in ·{" "}
              {lastUsage.outputTokens.toLocaleString()} out
            </span>
          )}
          {streaming ? (
            <Button
              variant="destructive"
              onClick={() => abortRef.current?.abort()}
            >
              <CircleStop className="size-4" /> Stop
            </Button>
          ) : (
            <Button variant="secondary" onClick={writeWithAI}>
              <PenLine className="size-4" />
              {wordCount > 0 ? "Continue with AI" : "Draft with AI"}
            </Button>
          )}
        </div>
      </div>

      {/* Side panel */}
      <aside className="flex w-80 shrink-0 flex-col border-l bg-card/30">
        <Tabs
          value={panel}
          onValueChange={setPanel}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="mx-3 mt-3">
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="issues">Issues</TabsTrigger>
          </TabsList>
          <TabsContent value="context" className="min-h-0 flex-1">
            <ContextPanel
              characters={characters}
              locations={locations}
              elements={elements}
              selection={selection}
              onToggle={toggleSelection}
            />
          </TabsContent>
          <TabsContent value="plan" className="min-h-0 flex-1">
            <PlanPanel
              novelId={novelId}
              chapterId={chapterId}
              chapter={chapter}
              selection={selection}
              instruction={instruction}
              disabled={streaming}
              onChapterUpdate={(updated) => {
                setChapter(updated);
                setTitle(updated.title);
                titleRef.current = updated.title;
              }}
              onWriteBeat={writeBeat}
            />
          </TabsContent>
          <TabsContent value="issues" className="min-h-0 flex-1">
            <ContinuityPanel
              novelId={novelId}
              chapterId={chapterId}
              disabled={!wordCount || streaming}
              onLocate={(quote) =>
                editorRef.current?.highlightQuote(quote) ?? false
              }
            />
          </TabsContent>
        </Tabs>
      </aside>

      <AnalyzeDialog
        novelId={novelId}
        chapterId={chapterId}
        chapterNumber={chapter.number}
        characters={characters}
        relationships={relationships}
        storyEvents={storyEvents}
        elements={elements}
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        onMerged={() => loadAll().catch(() => {})}
      />

      <ContextInspector
        novelId={novelId}
        chapterId={chapterId}
        selection={selection}
        instruction={instruction}
        draftTail={() => contentRef.current}
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
      />

      <RevisionHistory
        chapterId={chapterId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        currentContent={() => contentRef.current}
        onRestore={(content) => {
          editorRef.current?.setMarkdown(content);
          contentRef.current = content;
          setWordCount(countWords(content));
          scheduleSave();
        }}
      />
    </div>
  );
}

function countWords(text: string) {
  const stripped = text.replace(/[#*_>`~\-]/g, " ").trim();
  return stripped ? stripped.split(/\s+/).length : 0;
}
