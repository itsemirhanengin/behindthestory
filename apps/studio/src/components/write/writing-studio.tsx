"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  RiArrowLeftLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiEyeLine,
  RiHistoryLine,
  RiLayoutRightLine,
  RiLoader4Line,
  RiMore2Line,
  RiSideBarLine,
  RiSparkling2Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  fetchEntity,
  fetchEntityList,
  useUpdateEntity,
} from "@/lib/queries/entities";
import { useAiFeedbackDecision, useAiFeedbackRating } from "@/lib/queries/ai";
import {
  useActivateVariant,
  useSaveRevision,
} from "@/lib/queries/chapters";
import {
  fetchNovel,
  fetchRelationships,
  fetchStoryEvents,
} from "@/lib/queries/story";
import { notifyIfOutOfWords } from "@/lib/out-of-words";
import { cn } from "@/lib/utils";
import {
  consumeProseStream,
  type ProsePhase,
  type ProseWireUsage,
} from "@behindthestory/core/prose-stream";
import { useNovelWorkspace } from "@/components/novel-workspace";
import { AnalyzeDialog } from "./analyze-dialog";
import { AssistComposer } from "./assist-composer";
import {
  AiFeedbackDialog,
  type FeedbackPrompt,
} from "./ai-feedback-dialog";
import {
  AiSuggestionCard,
  type AiSuggestion,
} from "./ai-suggestion-card";
import { ContextInspector } from "./context-inspector";
import { RevisionHistory } from "./revision-history";
import {
  ProseEditor,
  type ProseEditorHandle,
  type SuggestionContext,
  type SuggestionMode,
} from "./prose-editor";
import { WritingToolsPanel } from "./writing-tools-panel";
import type { Beat } from "@behindthestory/db/schema";
import type { Chapter, Character, Location, Novel, Relationship, StoryElement, StoryEvent } from "@/lib/queries/types";
import type { ContextSelection } from "./context-panel";

const INLINE_ACTIONS = [
  { key: "rewrite", label: "Rewrite" },
  { key: "shorten", label: "Tighten" },
  { key: "expand", label: "Expand" },
  { key: "dialogue", label: "Dialogue" },
] as const;

const AUTOSAVE_DELAY = 1200;
const RUNNING_PHASES: AiSuggestion["phase"][] = [
  "starting",
  "context",
  "model",
  "writing",
];

type GenerationSpec = {
  url: string;
  mode: SuggestionMode;
  label: string;
  atEnd?: boolean;
  body: (context: SuggestionContext) => unknown;
  onAccept?: () => void | Promise<void>;
};

type ActiveRequest = {
  spec: GenerationSpec;
  context: SuggestionContext;
};

type FeedbackDecisionResponse = {
  id: string;
  shouldPrompt: boolean;
  decisionCount?: number;
};

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
  const [panel, setPanel] = useState("plan");
  const [panelOpen, setPanelOpen] = useState(false);
  const [compactWorkspace, setCompactWorkspace] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistMode, setAssistMode] = useState<SuggestionMode>("insert");
  const [assistInstruction, setAssistInstruction] = useState("");
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [feedbackPrompt, setFeedbackPrompt] =
    useState<FeedbackPrompt | null>(null);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const editorRef = useRef<ProseEditorHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const suggestionTextRef = useRef("");
  const suggestionFrameRef = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncFrame = useRef<number | null>(null);
  const contentRef = useRef("");
  const titleRef = useRef("");
  const dirtyRef = useRef(false);
  const changeVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const saveErrorShownRef = useRef(false);
  const { sidebarOpen, toggleSidebar } = useNovelWorkspace();
  const updateChapter = useUpdateEntity<Chapter>(novelId);
  const activateVariant = useActivateVariant(novelId);
  const saveRevision = useSaveRevision(chapterId);
  const recordDecision = useAiFeedbackDecision();
  const rateSuggestion = useAiFeedbackRating();

  const loadAll = useCallback(async () => {
    setReady(false);
    const [nov, ch, chapters, chars, locs, elems, rels, evts] =
      await Promise.all([
        fetchNovel(novelId),
        fetchEntity<Chapter>("chapters", chapterId),
        fetchEntityList<Chapter>(novelId, "chapters"),
        fetchEntityList<Character>(novelId, "characters"),
        fetchEntityList<Location>(novelId, "locations"),
        fetchEntityList<StoryElement>(novelId, "story-elements"),
        fetchRelationships(novelId),
        fetchStoryEvents(novelId),
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
    dirtyRef.current = false;
    savedVersionRef.current = changeVersionRef.current;
    setSaveState("saved");
    setWordCount(countWords(ch.content));
    setSelection({
      characterIds: new Set(),
      locationIds: new Set(),
      elementIds: new Set(),
    });
    setReady(true);
  }, [novelId, chapterId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      loadAll().catch((error) => toast.error(error.message));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadAll]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setCompactWorkspace(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const persist = useCallback(async () => {
    const version = changeVersionRef.current;
    setSaveState("saving");
    try {
      await updateChapter.mutateAsync({
        entity: "chapters",
        id: chapterId,
        values: { title: titleRef.current, content: contentRef.current },
      });
      savedVersionRef.current = Math.max(savedVersionRef.current, version);
      if (savedVersionRef.current >= changeVersionRef.current) {
        dirtyRef.current = false;
        saveErrorShownRef.current = false;
        setSaveState("saved");
      } else {
        dirtyRef.current = true;
        setSaveState("dirty");
      }
    } catch {
      setSaveState("dirty");
      if (!saveErrorShownRef.current) {
        saveErrorShownRef.current = true;
        toast.error("This chapter could not be saved. Your draft is still open.");
      }
    }
  }, [chapterId]);

  const scheduleSave = useCallback(() => {
    changeVersionRef.current += 1;
    dirtyRef.current = true;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void persist();
    }, AUTOSAVE_DELAY);
  }, [persist]);

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

  useEffect(() => {
    const editor = editorRef.current;
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const latestMarkdown = editor?.getMarkdown() ?? contentRef.current;
      const editorChanged = latestMarkdown !== contentRef.current;
      contentRef.current = latestMarkdown;
      if (syncFrame.current !== null) cancelAnimationFrame(syncFrame.current);
      if (suggestionFrameRef.current !== null) {
        cancelAnimationFrame(suggestionFrameRef.current);
      }
      abortRef.current?.abort();
      if (!dirtyRef.current && !editorChanged) return;
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

  const suggestionRunning = Boolean(
    suggestion && RUNNING_PHASES.includes(suggestion.phase),
  );

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || suggestionRunning) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [suggestionRunning]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        if (suggestion) return;
        const mode = editorRef.current?.hasSelection() ? "replace" : "insert";
        setAssistMode(mode);
        setAssistOpen(true);
      }
      if (event.key === "Escape" && assistOpen) setAssistOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assistOpen, suggestion]);

  function updateTitle(next: string) {
    setTitle(next);
    titleRef.current = next;
    scheduleSave();
  }

  const toggleSelection = useCallback(
    (kind: "character" | "location" | "element", id: string) => {
      setSelection((current) => {
        const key =
          kind === "character"
            ? "characterIds"
            : kind === "location"
              ? "locationIds"
              : "elementIds";
        const next = new Set(current[key]);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { ...current, [key]: next };
      });
    },
    [],
  );

  const pinnedContextCount =
    selection.characterIds.size +
    selection.locationIds.size +
    selection.elementIds.size;

  const snapshot = useCallback(
    (label: string) =>
      saveRevision
        .mutateAsync({ label, content: contentRef.current })
        .catch(() => {}),
    [saveRevision],
  );

  function flushSuggestionText() {
    if (suggestionFrameRef.current !== null) {
      cancelAnimationFrame(suggestionFrameRef.current);
      suggestionFrameRef.current = null;
    }
    const text = suggestionTextRef.current;
    setSuggestion((current) => (current ? { ...current, text } : current));
  }

  async function executeGeneration(request: ActiveRequest) {
    const controller = new AbortController();
    abortRef.current = controller;
    suggestionTextRef.current = "";
    const id = crypto.randomUUID();
    setSuggestion({
      id,
      label: request.spec.label,
      mode: request.spec.mode,
      phase: "starting",
      detail: "Opening a live suggestion",
      text: "",
      // This is created only from user-triggered generation handlers.
      // eslint-disable-next-line react-hooks/purity
      startedAt: Date.now(),
    });
    setAssistOpen(false);

    let failure: string | undefined;
    try {
      const response = await fetch(request.spec.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(request.spec.body(request.context)),
      });
      await consumeProseStream(response, {
        onStatus: (phase: ProsePhase, detail?: string) => {
          setSuggestion((current) =>
            current?.id === id ? { ...current, phase, detail } : current,
          );
        },
        onDelta: (text) => {
          suggestionTextRef.current += text;
          if (suggestionFrameRef.current === null) {
            suggestionFrameRef.current = requestAnimationFrame(() => {
              suggestionFrameRef.current = null;
              const streamedText = suggestionTextRef.current;
              setSuggestion((current) =>
                current?.id === id
                  ? { ...current, text: streamedText }
                  : current,
              );
            });
          }
        },
        onUsage: (usage: ProseWireUsage) => {
          setSuggestion((current) =>
            current?.id === id ? { ...current, usage } : current,
          );
        },
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        // The streaming endpoints do not go through TanStack's mutation cache,
        // so the out-of-words toast has to be raised here too.
        notifyIfOutOfWords(error);
        failure = (error as Error).message;
      }
    } finally {
      flushSuggestionText();
      const streamedText = suggestionTextRef.current;
      setSuggestion((current) => {
        if (current?.id !== id) return current;
        if (failure) {
          return { ...current, phase: "error", error: failure, text: streamedText };
        }
        if (controller.signal.aborted) {
          return {
            ...current,
            phase: "stopped",
            detail: streamedText
              ? "The partial suggestion is still available to review."
              : undefined,
            error: streamedText ? undefined : "Generation was stopped.",
            text: streamedText,
          };
        }
        return streamedText
          ? { ...current, phase: "ready", detail: "Your manuscript is unchanged." }
          : {
              ...current,
              phase: "error",
              error: "The AI returned no prose.",
            };
      });
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function startGeneration(spec: GenerationSpec) {
    if (suggestion || abortRef.current) {
      toast.error("Accept or reject the current suggestion first.");
      return;
    }
    const context = editorRef.current?.startSuggestion(spec.mode, {
      atEnd: spec.atEnd,
    });
    if (!context) {
      toast.error(
        spec.mode === "replace"
          ? "Select a passage first."
          : "Place the cursor where you want the new passage.",
      );
      return;
    }
    const request = { spec, context };
    activeRequestRef.current = request;
    void executeGeneration(request);
  }

  function commonContextBody() {
    return {
      novelId,
      chapterId,
      selectedCharacterIds: [...selection.characterIds],
      selectedLocationIds: [...selection.locationIds],
      selectedElementIds: [...selection.elementIds],
    };
  }

  function runInline(
    action: (typeof INLINE_ACTIONS)[number]["key"],
    label: string,
    instruction?: string,
  ) {
    startGeneration({
      url: "/api/ai/inline",
      mode: "replace",
      label,
      body: (context) => ({
        ...commonContextBody(),
        action,
        selection: context.text,
        before: context.before,
        after: context.after,
        instruction: instruction || undefined,
      }),
    });
  }

  function writeAtCursor(
    instruction: string,
    options: { label?: string; beat?: Beat; atEnd?: boolean } = {},
  ) {
    const beat = options.beat;
    startGeneration({
      url: "/api/ai/chapter",
      mode: "insert",
      label: options.label ?? (wordCount ? "Continue scene" : "Draft opening"),
      atEnd: options.atEnd,
      body: (context) => ({
        ...commonContextBody(),
        beatId: beat?.id,
        instruction: instruction || undefined,
        existingContent: contentRef.current,
        placement: options.atEnd ? "end" : "cursor",
        before: context.before,
        after: context.after,
      }),
      onAccept: beat
        ? async () => {
            if (!chapter) return;
            try {
              const updated = await updateChapter.mutateAsync({
                entity: "chapters",
                id: chapterId,
                values: {
                  beats: chapter.beats.map((candidate) =>
                    candidate.id === beat.id
                      ? { ...candidate, done: true }
                      : candidate,
                  ),
                },
              });
              setChapter(updated);
            } catch {
              toast.error("The passage was accepted, but the beat was not marked done.");
            }
          }
        : undefined,
    });
  }

  function openAssist(mode?: SuggestionMode) {
    if (suggestion) {
      toast.error("Accept or reject the current suggestion first.");
      return;
    }
    setAssistMode(
      mode ?? (editorRef.current?.hasSelection() ? "replace" : "insert"),
    );
    setAssistOpen(true);
  }

  function submitAssist(instruction: string) {
    if (assistMode === "replace") {
      runInline("rewrite", "Custom edit", instruction);
    } else {
      writeAtCursor(instruction, {
        label: wordCount ? "Continue at cursor" : "Draft opening",
      });
    }
  }

  async function acceptSuggestion() {
    if (!suggestion?.text.trim()) return;
    const decidedSuggestion = suggestion;
    const request = activeRequestRef.current;
    await snapshot(`before accepting AI ${suggestion.mode}`);
    const accepted = editorRef.current?.acceptSuggestion(suggestion.text) ?? false;
    if (!accepted) {
      toast.error("The original passage moved and could not be replaced safely.");
      return;
    }
    setSuggestion(null);
    activeRequestRef.current = null;
    suggestionTextRef.current = "";
    void recordSuggestionDecision(decidedSuggestion, "accepted", request);
    await request?.spec.onAccept?.();
  }

  function rejectSuggestion() {
    const decidedSuggestion = suggestion;
    const request = activeRequestRef.current;
    discardCurrentSuggestion();
    if (decidedSuggestion?.text.trim()) {
      void recordSuggestionDecision(decidedSuggestion, "rejected", request);
    }
  }

  function discardCurrentSuggestion() {
    abortRef.current?.abort();
    editorRef.current?.discardSuggestion();
    setSuggestion(null);
    activeRequestRef.current = null;
    suggestionTextRef.current = "";
  }

  async function recordSuggestionDecision(
    decidedSuggestion: AiSuggestion,
    decision: "accepted" | "rejected",
    request: ActiveRequest | null,
  ) {
    try {
      const result = (await recordDecision.mutateAsync({
          suggestionId: decidedSuggestion.id,
          novelId,
          chapterId,
          decision,
          mode: decidedSuggestion.mode,
          route: request?.spec.url.replace("/api/ai/", "") ?? "unknown",
          label: decidedSuggestion.label,
          suggestionText: decidedSuggestion.text,
          inputTokens: decidedSuggestion.usage?.inputTokens ?? 0,
          outputTokens: decidedSuggestion.usage?.outputTokens ?? 0,
      })) as FeedbackDecisionResponse;
      if (result.shouldPrompt) {
        setFeedbackPrompt({
          id: result.id,
          decision,
          label: decidedSuggestion.label,
        });
      }
    } catch (error) {
      toast.error((error as Error).message || "The AI decision could not be recorded.");
    }
  }

  function retrySuggestion() {
    const request = activeRequestRef.current;
    if (!request || abortRef.current) return;
    void executeGeneration(request);
  }

  const { prev, next } = useMemo(() => {
    if (!chapter) return { prev: null, next: null };
    const spine = allChapters.filter((candidate) => candidate.isActive);
    return {
      prev:
        spine.find((candidate) => candidate.number === chapter.number - 1) ??
        null,
      next:
        spine.find((candidate) => candidate.number === chapter.number + 1) ??
        null,
    };
  }, [allChapters, chapter]);

  const target = novel?.targetChapterWords ?? 0;
  const progress = target > 0 ? Math.min(100, (wordCount / target) * 100) : 0;

  if (!chapter || !ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <RiLoader4Line className="size-5 animate-spin" />
      </div>
    );
  }

  const tools = (
    <WritingToolsPanel
      panel={panel}
      novelId={novelId}
      chapterId={chapterId}
      chapter={chapter}
      characters={characters}
      locations={locations}
      elements={elements}
      selection={selection}
      disabled={Boolean(suggestion)}
      onPanelChange={setPanel}
      onToggleContext={toggleSelection}
      onChapterUpdate={(updated) => {
        setChapter(updated);
        setTitle(updated.title);
        titleRef.current = updated.title;
      }}
      onWriteBeat={(beat) =>
        writeAtCursor("", { label: `Draft beat`, beat })
      }
      onAnalyze={() => setAnalyzeOpen(true)}
      onLocate={(quote) => editorRef.current?.highlightQuote(quote) ?? false}
    />
  );

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="relative shrink-0 border-b bg-background">
          <div
            className={cn(
              "flex h-12 min-w-0 items-center gap-1.5 px-2 pl-12 sm:gap-2 sm:px-3 sm:pl-12 lg:pl-3",
              !sidebarOpen && "lg:pl-12",
            )}
          >
            {sidebarOpen && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="relative max-lg:hidden"
                onClick={toggleSidebar}
                aria-label="Hide novel navigation"
              >
                <RiSideBarLine />
                <span
                  className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                  aria-hidden="true"
                />
              </Button>
            )}

            <Link
              href={`/novels/${novelId}/story`}
              className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
              aria-label="Back to story map"
            >
              <RiArrowLeftLine className="size-4 shrink-0" />
              <span className="max-xl:hidden">Story map</span>
            </Link>

            <div className="flex shrink-0 items-center">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={!prev}
                asChild={Boolean(prev)}
                aria-label="Previous chapter"
              >
                {prev ? (
                  <Link href={`/novels/${novelId}/write/${prev.id}`}>
                    <RiArrowLeftSLine />
                  </Link>
                ) : (
                  <RiArrowLeftSLine />
                )}
              </Button>
              <p className="whitespace-nowrap tabular-nums text-muted-foreground">
                Ch. {chapter.number}
              </p>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={!next}
                asChild={Boolean(next)}
                aria-label="Next chapter"
              >
                {next ? (
                  <Link href={`/novels/${novelId}/write/${next.id}`}>
                    <RiArrowRightSLine />
                  </Link>
                ) : (
                  <RiArrowRightSLine />
                )}
              </Button>
            </div>

            <Input
              name="chapter-title"
              aria-label="Chapter title"
              value={title}
              onChange={(event) => updateTitle(event.target.value)}
              className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-2 font-medium focus-visible:border-input max-sm:text-base"
            />

            <Select
              value={chapter.status}
              onValueChange={async (value) => {
                const updated = await updateChapter.mutateAsync({
                  entity: "chapters",
                  id: chapterId,
                  values: { status: value },
                });
                setChapter(updated);
              }}
            >
              <SelectTrigger
                size="sm"
                className="hidden w-20 sm:flex"
                aria-label="Chapter status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="final">Final</SelectItem>
              </SelectContent>
            </Select>

            <div className="hidden items-center gap-2 whitespace-nowrap text-muted-foreground md:flex">
              <p className="tabular-nums">
                {wordCount.toLocaleString()}
                {target > 0 ? ` / ${target.toLocaleString()}` : ""} words
              </p>
              <p aria-live="polite">
                {saveState === "saved"
                  ? "Saved"
                  : saveState === "saving"
                    ? "Saving…"
                    : "Unsaved"}
              </p>
            </div>

            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => openAssist()}
              disabled={Boolean(suggestion)}
              aria-keyshortcuts="Meta+J Control+J"
            >
              <RiSparkling2Line data-icon="inline-start" />
              <span className="max-sm:hidden">Assist</span>
            </Button>

            <Button
              type="button"
              size="icon-sm"
              variant={panelOpen ? "secondary" : "ghost"}
              className="relative"
              onClick={() => setPanelOpen((open) => !open)}
              aria-label={panelOpen ? "Close writing tools" : "Open writing tools"}
              aria-pressed={panelOpen}
            >
              <RiLayoutRightLine />
              <span
                className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                aria-hidden="true"
              />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="relative"
                  aria-label="More chapter actions"
                >
                  <RiMore2Line />
                  <span
                    className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                    aria-hidden="true"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                  <RiHistoryLine /> Revision history
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setInspectorOpen(true)}>
                  <RiEyeLine /> What AI uses
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={toggleSidebar}>
                  <RiSideBarLine />
                  {sidebarOpen ? "Enter focus mode" : "Show novel navigation"}
                </DropdownMenuItem>
                {chapter.variantLabel && !chapter.isActive && (
                  <DropdownMenuItem
                    onSelect={async () => {
                      try {
                        const updated = await activateVariant.mutateAsync(
                          chapterId,
                        );
                        setChapter(updated);
                        toast.success(`Take ${updated.variantLabel} is now active.`);
                      } catch (error) {
                        toast.error((error as Error).message);
                      }
                    }}
                  >
                    Make take {chapter.variantLabel} active
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {target > 0 && (
            <div
              className="absolute inset-x-0 -bottom-px h-px bg-muted"
              aria-hidden="true"
            >
              <div
                className={cn(
                  "h-full w-(--chapter-progress) bg-primary",
                  progress >= 100 && "bg-affirm",
                )}
                style={{ "--chapter-progress": `${progress}%` } as React.CSSProperties}
              />
            </div>
          )}
        </header>

        <main className="relative flex min-h-0 min-w-0 flex-1">
          <ProseEditor
            ref={editorRef}
            initialMarkdown={chapter.content}
            editable
            placeholder={`Begin Chapter ${chapter.number}. Write freely, or press ⌘J when you want assistance.`}
            onChange={handleEditorChange}
            showBubbleMenu={!suggestion && !assistOpen}
            bubbleActions={
              <>
                {INLINE_ACTIONS.map((action) => (
                  <Button
                    key={action.key}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => runInline(action.key, action.label)}
                  >
                    {action.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => openAssist("replace")}
                >
                  Custom…
                </Button>
              </>
            }
          />

          {assistOpen && !suggestion && (
            <AssistComposer
              instruction={assistInstruction}
              selectionActive={assistMode === "replace"}
              contextCount={pinnedContextCount}
              onInstructionChange={setAssistInstruction}
              onSubmit={submitAssist}
              onClose={() => setAssistOpen(false)}
            />
          )}

          {suggestion && (
            <AiSuggestionCard
              suggestion={suggestion}
              onAccept={() => void acceptSuggestion()}
              onReject={rejectSuggestion}
              onStop={() => abortRef.current?.abort()}
              onRetry={retrySuggestion}
            />
          )}
        </main>

        <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t px-3 text-muted-foreground md:hidden">
          <p className="tabular-nums">
            {wordCount.toLocaleString()}
            {target > 0 ? ` / ${target.toLocaleString()}` : ""} words
          </p>
          <p aria-live="polite">
            {saveState === "saved"
              ? "Saved"
              : saveState === "saving"
                ? "Saving…"
                : "Unsaved"}
          </p>
        </footer>
      </div>

      {!compactWorkspace && panelOpen && (
        <aside className="flex w-[22rem] shrink-0 flex-col border-l bg-card/30">
          {tools}
        </aside>
      )}

      {compactWorkspace && (
        <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
          <SheetContent
            side="right"
            className="w-[min(24rem,92vw)] gap-0 p-0 sm:max-w-md"
          >
            <SheetTitle className="sr-only">Writing tools</SheetTitle>
            <SheetDescription className="sr-only">
              Chapter plan, pinned story sources, and review tools.
            </SheetDescription>
            {tools}
          </SheetContent>
        </Sheet>
      )}

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
        instruction={assistInstruction}
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
          discardCurrentSuggestion();
          editorRef.current?.setMarkdown(content);
          contentRef.current = content;
          setWordCount(countWords(content));
          scheduleSave();
        }}
      />

      {feedbackPrompt && (
        <AiFeedbackDialog
          key={feedbackPrompt.id}
          prompt={feedbackPrompt}
          onSkip={() => setFeedbackPrompt(null)}
          onSubmit={async (rating, comment) => {
            try {
              await rateSuggestion.mutateAsync({
                id: feedbackPrompt.id,
                rating,
                comment,
              });
              setFeedbackPrompt(null);
              toast.success("Thanks — your feedback was saved.");
            } catch (error) {
              toast.error((error as Error).message);
              throw error;
            }
          }}
        />
      )}
    </div>
  );
}

function countWords(text: string) {
  const stripped = text.replace(/[#*_>`~\-]/g, " ").trim();
  return stripped ? stripped.split(/\s+/).length : 0;
}
