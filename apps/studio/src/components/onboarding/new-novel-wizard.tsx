"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  RiArrowLeftLine,
  RiBookOpenLine,
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import {
  useAiOnboardingReading,
  useAiOnboardingStyle,
} from "@/lib/queries/ai";
import { useCreateNovel } from "@/lib/queries/novels";
import {
  useDeleteNovelDraft,
  useNovelDraft,
  useSaveNovelDraft,
  type NovelDraft,
  type NovelDraftInput,
} from "@/lib/queries/novel-drafts";
import {
  MIN_DESCRIPTION_WORDS,
  countWords,
  type Reading,
  type ReadingRequest,
  type ReadingResponse,
  type StyleFields,
  type StyleProposal,
  type StyleRequest,
  type StyleResponse,
  type WizardTurn,
} from "@behindthestory/core/onboarding";
import { PremiseStep } from "./premise-step";
import { AlignmentStep } from "./alignment-step";
import { StyleStep } from "./style-step";
import { ReviewStep } from "./review-step";

const STEPS = [
  {
    label: "Premise",
    heading: "What is this novel?",
    subheading:
      "Write it the way you would tell a friend over a long dinner. None of it has to be final — it only has to be true.",
    width: "max-w-5xl",
  },
  {
    label: "Alignment",
    heading: "Did it understand you?",
    subheading:
      "This is what the AI thinks your book is. Correct it until it is right — every chapter it ever writes is generated against this reading.",
    width: "max-w-6xl",
  },
  {
    label: "House style",
    heading: "How it should be written",
    subheading:
      "Derived from your premise. These become binding rules on every generation, so change anything that is not you.",
    width: "max-w-3xl",
  },
  {
    label: "Title page",
    heading: "Everything in one place",
    subheading:
      "Exactly what will be created. Every word of it stays editable in the Story Bible afterwards.",
    width: "max-w-3xl",
  },
] as const;

const LAST_STEP = STEPS.length - 1;

/** Same cadence as the chapter editor: long enough to sit out a burst of
 *  typing, short enough that a closed tab loses at most a phrase. */
const AUTOSAVE_DELAY = 1200;

type DraftSaveState = "dirty" | "saving" | "saved";

/**
 * The draft has to be in hand before the form mounts: hydrating server state
 * into a wizard the author has already started typing in would clobber them,
 * so the form is simply not rendered until the row is in. The row always
 * exists — "New novel" creates it before routing here — so an error means the
 * draft is genuinely gone (discarded on another device), not a blip.
 */
export function NewNovelWizard({ draftId }: { draftId: string }) {
  const draft = useNovelDraft(draftId);

  if (draft.isError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Draft
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          This draft is gone
        </h1>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          It was discarded or already published — possibly from another device.
          Nothing on the shelf was harmed.
        </p>
        <Button asChild variant="secondary">
          <Link href="/">Back to the shelf</Link>
        </Button>
      </div>
    );
  }

  if (draft.isPending) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <RiLoader4Line className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <WizardForm draft={draft.data} />;
}

function WizardForm({ draft }: { draft: NovelDraft }) {
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);
  const readNovel = useAiOnboardingReading();
  const proposeStyle = useAiOnboardingStyle();
  const createNovel = useCreateNovel();
  const saveDraft = useSaveNovelDraft(draft.id);
  const deleteDraft = useDeleteNovelDraft();

  const [step, setStep] = useState(draft.step);
  const [maxStep, setMaxStep] = useState(draft.maxStep);

  const [title, setTitle] = useState(draft.title);
  const [titleFromAi, setTitleFromAi] = useState(draft.titleFromAi);
  const [description, setDescription] = useState(draft.description);

  // The jsonb columns come back untyped; the PUT that stored them validated
  // these exact shapes with zod schemas that `satisfies` the core types, so
  // the casts narrow rather than assert.
  const [reading, setReading] = useState<Reading | null>(
    () => draft.reading as Reading | null,
  );
  const [readingRevision, setReadingRevision] = useState(draft.readingRevision);
  const [readingBusy, setReadingBusy] = useState(false);
  const [readingError, setReadingError] = useState<string | null>(null);
  const [turns, setTurns] = useState<WizardTurn[]>(
    () => draft.turns as WizardTurn[],
  );

  const [style, setStyle] = useState<StyleFields | null>(
    () => draft.style as StyleFields | null,
  );
  const [styleProposal, setStyleProposal] = useState<StyleProposal | null>(
    () => draft.styleProposal as StyleProposal | null,
  );
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);
  /** Which reading revision the current style was derived from. */
  const [styleFrom, setStyleFrom] = useState(draft.styleFrom);

  const [creating, setCreating] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [saveState, setSaveState] = useState<DraftSaveState>("saved");

  // Refs rather than the busy flags: the effects below fire on step entry, and
  // a state update that has not landed yet would let a second request through.
  const inFlight = useRef({ reading: false, style: false });

  // --- Draft autosave ------------------------------------------------------
  // The same version-stamped debounce as the chapter editor: every change bumps
  // `changeVersion`, a save only counts as caught-up when the version it
  // carried is still the newest one when the response lands.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const changeVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const saveErrorShownRef = useRef(false);
  /** Set before discard and publish so the unmount flush cannot resurrect a
   *  draft those paths just deleted. */
  const suppressFlushRef = useRef(false);
  const snapshotRef = useRef<NovelDraftInput | null>(null);

  // Refreshed every render, same as `advanceRef` below: the flush paths read
  // the newest state without a dependency list that would resubscribe them.
  useEffect(() => {
    snapshotRef.current = {
      step,
      maxStep,
      title,
      titleFromAi,
      description,
      reading,
      readingRevision,
      turns,
      style,
      styleProposal,
      styleFrom,
    };
  });

  const saveDraftAsync = saveDraft.mutateAsync;
  const persistDraft = useCallback(async () => {
    const snapshot = snapshotRef.current;
    if (!snapshot || suppressFlushRef.current) return;
    const version = changeVersionRef.current;
    setSaveState("saving");
    try {
      await saveDraftAsync(snapshot);
      savedVersionRef.current = Math.max(savedVersionRef.current, version);
      if (savedVersionRef.current >= changeVersionRef.current) {
        dirtyRef.current = false;
        saveErrorShownRef.current = false;
        setSaveState("saved");
      } else {
        setSaveState("dirty");
      }
    } catch {
      setSaveState("dirty");
      if (!saveErrorShownRef.current) {
        saveErrorShownRef.current = true;
        toast.error(
          "The draft could not be saved. Your work is still open here.",
        );
      }
    }
  }, [saveDraftAsync]);

  const scheduleSave = useCallback(() => {
    changeVersionRef.current += 1;
    dirtyRef.current = true;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void persistDraft();
    }, AUTOSAVE_DELAY);
  }, [persistDraft]);

  // Any persisted field changing schedules a save. The first run is the
  // hydration itself, not a change.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    scheduleSave();
  }, [
    step,
    maxStep,
    title,
    titleFromAi,
    description,
    reading,
    readingRevision,
    turns,
    style,
    styleProposal,
    styleFrom,
    scheduleSave,
  ]);

  /** Last-chance write, bypassing the RPC client: `keepalive` lets it outlive
   *  the page, which is the whole point of both call sites. */
  const flushDraft = useCallback(() => {
    if (suppressFlushRef.current || !dirtyRef.current) return;
    const snapshot = snapshotRef.current;
    if (!snapshot) return;
    fetch(`/api/novel-drafts/${draft.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
      keepalive: true,
    }).catch(() => {});
  }, [draft.id]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushDraft();
    };
  }, [flushDraft]);

  // A closing tab gets the pending debounce flushed rather than a scare
  // dialog: the draft outliving the tab is the feature.
  useEffect(() => {
    window.addEventListener("pagehide", flushDraft);
    return () => window.removeEventListener("pagehide", flushDraft);
  }, [flushDraft]);
  // --------------------------------------------------------------------------

  const runReading = useCallback(
    async (corrections: string[]): Promise<Reading | null> => {
      if (inFlight.current.reading) return null;
      inFlight.current.reading = true;
      setReadingBusy(true);
      setReadingError(null);
      try {
        const body: ReadingRequest = {
          title,
          description,
          corrections,
          previous: reading,
        };
        const res = (await readNovel.mutateAsync(body)) as ReadingResponse;
        setReading(res.reading);
        setReadingRevision((r) => r + 1);
        // An untitled novel gets named here, which is also why the title stays
        // editable on the alignment step rather than only on step one.
        if (!title.trim() && res.reading.titleSuggestions[0]) {
          setTitle(res.reading.titleSuggestions[0]);
          setTitleFromAi(true);
        }
        return res.reading;
      } catch (e) {
        const message = (e as Error).message;
        setReadingError(message);
        toast.error(message);
        return null;
      } finally {
        inFlight.current.reading = false;
        setReadingBusy(false);
      }
    },
    [title, description, reading],
  );

  const refine = useCallback(
    async (correction: string) => {
      const result = await runReading([
        ...turns.map((t) => t.correction),
        correction,
      ]);
      if (result) {
        setTurns((t) => [...t, { correction, changeNote: result.changeNote }]);
      }
    },
    [turns, runReading],
  );

  const runStyle = useCallback(async () => {
    if (!reading || inFlight.current.style) return;
    inFlight.current.style = true;
    setStyleBusy(true);
    setStyleError(null);
    const derivedFrom = readingRevision;
    try {
      const body: StyleRequest = { title, reading };
      const res = (await proposeStyle.mutateAsync(body)) as StyleResponse;
      setStyleProposal(res.style);
      setStyle({
        genre: res.style.genre,
        tone: res.style.tone,
        pov: res.style.pov,
        tense: res.style.tense,
        targetChapterWords: res.style.targetChapterWords,
        styleNotes: res.style.styleNotes,
      });
      setStyleFrom(derivedFrom);
    } catch (e) {
      const message = (e as Error).message;
      setStyleError(message);
      toast.error(message);
    } finally {
      inFlight.current.style = false;
      setStyleBusy(false);
    }
  }, [reading, readingRevision, title]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const words = countWords(description);
  const canContinue =
    step === 0
      ? words >= MIN_DESCRIPTION_WORDS
      : step === 1
        ? Boolean(reading) && title.trim().length > 0 && !readingBusy
        : step === 2
          ? Boolean(style)
          : false;

  /**
   * Both AI steps kick off as you arrive — being asked to press a button to
   * start the only thing a step does is friction, not control. It happens here
   * rather than in an effect because every route into a step (Continue, Back,
   * the stepper) goes through this function, and a failed call must *not*
   * retry itself on every render: the retry buttons hand that back to the
   * author. Work already done is never redone; a reading the author changed
   * afterwards surfaces on step three as "re-derive" instead.
   */
  const goTo = useCallback(
    (next: number) => {
      setStep(next);
      setMaxStep((m) => Math.max(m, next));
      if (next === 1 && !reading && !readingError) void runReading([]);
      if (next === 2 && reading && !style && !styleError) void runStyle();
    },
    [reading, readingError, runReading, style, styleError, runStyle],
  );

  // A draft with work in it re-enters its step through `goTo` so a session
  // that closed mid-generation picks the request back up, exactly as if the
  // author had just clicked Continue. A freshly minted draft skips all of it —
  // being told "restored" on a blank page would be noise.
  const resumedRef = useRef(false);
  const hadProgress =
    draft.step > 0 ||
    draft.title.trim() !== "" ||
    draft.description.trim() !== "";
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    if (!hadProgress) return;
    toast("Draft restored", {
      description: "Everything is exactly where you left it.",
    });
    goTo(step);
  }, [hadProgress, step, goTo]);

  /** `fromAi` is what keeps the "named by AI" badge honest when the author picks
   *  one of the suggested titles instead of typing their own. */
  const changeTitle = useCallback((value: string, fromAi = false) => {
    setTitle(value);
    setTitleFromAi(fromAi);
  }, []);

  const deleteDraftMutate = deleteDraft.mutate;

  const create = useCallback(async () => {
    if (!reading || !style || creating) return;
    setCreating(true);
    try {
      const novel = await createNovel.mutateAsync({
        title: title.trim(),
        premise: reading.premise,
        ...style,
      });
      // The draft has been published; from here nothing may write it back.
      // Deleting it is fire-and-forget — a failed cleanup must not block the
      // novel that already exists.
      suppressFlushRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      deleteDraftMutate(draft.id);
      toast.success(`“${novel.title}” is ready`);
      router.push(`/novels/${novel.id}/bible`);
    } catch (e) {
      toast.error((e as Error).message);
      setCreating(false);
    }
  }, [reading, style, creating, title, router, deleteDraftMutate, draft.id]);

  const discardDraft = useCallback(() => {
    suppressFlushRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    deleteDraftMutate(draft.id);
    router.push("/");
  }, [deleteDraftMutate, draft.id, router]);

  // Keeps ⌘↵ bound to one listener instead of resubscribing on every render.
  const advanceRef = useRef(() => {});
  useEffect(() => {
    advanceRef.current = () => {
      if (step === LAST_STEP) void create();
      else if (canContinue) goTo(step + 1);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        advanceRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dirty = description.trim().length > 0 || title.trim().length > 0;
  const active = STEPS[step];

  const hint =
    step === 0
      ? words >= MIN_DESCRIPTION_WORDS
        ? "The AI reads this next."
        : `${MIN_DESCRIPTION_WORDS - words} more words and the AI has something to work with.`
      : step === 1
        ? readingBusy
          ? "Re-reading…"
          : reading
            ? "Keep correcting until this is your book."
            : "Waiting on the AI."
        : step === 2
          ? "All of it stays editable later."
          : "Creating turns this draft into the novel.";

  // No ambient glow behind the chrome: a glow is a shadow by another name, and
  // the page is lit by its own ground.
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <RiBookOpenLine className="size-4 shrink-0 text-primary" />
            <span className="font-heading text-sm font-semibold tracking-tight">
              BehindTheStory
            </span>
            <span className="text-border">/</span>
            <span className="truncate text-sm text-muted-foreground">
              {title.trim() || "New novel"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <DraftStatus state={saveState} />
            <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
              Step {step + 1} of {STEPS.length}
            </span>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Leave the wizard"
              onClick={() => (dirty ? setExitOpen(true) : router.push("/"))}
            >
              <RiCloseLine className="size-4" />
            </Button>
          </div>
        </div>

        <nav aria-label="Progress" className="mx-auto w-full max-w-6xl px-6 pb-3">
          <ol className="flex gap-2">
            {STEPS.map((s, i) => {
              const done = i < step;
              const reachable = i <= maxStep;
              return (
                <li key={s.label} className="min-w-0 flex-1">
                  <button
                    type="button"
                    disabled={!reachable || i === step}
                    onClick={() => goTo(i)}
                    aria-current={i === step ? "step" : undefined}
                    className="w-full text-left disabled:cursor-default"
                  >
                    <span
                      className={cn(
                        "block h-0.5 w-full rounded-none transition-colors",
                        i === step
                          ? "bg-primary"
                          : done
                            ? "bg-primary/50"
                            : "bg-border",
                      )}
                    />
                    <span className="mt-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em]">
                      {done ? (
                        <RiCheckLine className="size-3 shrink-0 text-primary" />
                      ) : (
                        <span
                          className={cn(
                            "tabular-nums",
                            i === step
                              ? "text-primary"
                              : "text-muted-foreground/60",
                          )}
                        >
                          {i + 1}
                        </span>
                      )}
                      <span
                        className={cn(
                          "truncate",
                          i === step
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {s.label}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          key={step}
          className={cn(
            "mx-auto w-full px-6 pb-16 pt-10 duration-500 animate-in fade-in slide-in-from-bottom-3",
            active.width,
          )}
        >
          <header className="mb-8 max-w-2xl">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {active.label}
            </p>
            <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              {active.heading}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {active.subheading}
            </p>
          </header>

          {step === 0 && (
            <PremiseStep
              title={title}
              description={description}
              onTitleChange={changeTitle}
              onDescriptionChange={setDescription}
            />
          )}

          {step === 1 && (
            <AlignmentStep
              title={title}
              titleFromAi={titleFromAi}
              onTitleChange={changeTitle}
              reading={reading}
              busy={readingBusy}
              error={readingError}
              turns={turns}
              onRefine={refine}
              onRetry={() => void runReading(turns.map((t) => t.correction))}
            />
          )}

          {step === 2 && (
            <StyleStep
              style={style}
              proposal={styleProposal}
              busy={styleBusy}
              error={styleError}
              stale={style !== null && styleFrom !== readingRevision}
              onChange={(patch) =>
                setStyle((s) => (s ? { ...s, ...patch } : s))
              }
              onRederive={() => void runStyle()}
            />
          )}

          {step === 3 && reading && style && (
            <ReviewStep
              title={title}
              reading={reading}
              style={style}
              onJumpTo={goTo}
            />
          )}
        </div>
      </main>

      <footer className="shrink-0 border-t bg-background">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <Button
            variant="ghost"
            onClick={() => goTo(step - 1)}
            disabled={step === 0}
          >
            <RiArrowLeftLine className="size-4" /> Back
          </Button>
          <div className="flex items-center gap-4">
            <p className="hidden text-xs text-muted-foreground sm:block">
              {hint}
            </p>
            {step === LAST_STEP ? (
              <Button size="lg" onClick={() => void create()} disabled={creating}>
                {creating ? (
                  <RiLoader4Line className="size-4 animate-spin" />
                ) : (
                  <RiBookOpenLine className="size-4" />
                )}
                {creating ? "Creating…" : "Create novel"}
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={() => goTo(step + 1)}
                disabled={!canContinue}
              >
                Continue
                <kbd className="ml-1 rounded border border-primary-foreground/25 px-1 font-sans text-[10px] leading-4 opacity-60">
                  ⌘↵
                </kbd>
              </Button>
            )}
          </div>
        </div>
      </footer>

      <AlertDialog open={exitOpen} onOpenChange={setExitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Step away for now?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft saves itself as you work — the premise and everything
              the AI worked out from it will be waiting right here. Discard it
              only if this novel is not happening.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <Button variant="outline" onClick={discardDraft}>
              Discard draft
            </Button>
            <AlertDialogAction onClick={() => router.push("/")}>
              Save &amp; leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The autosave's word to the author. Silent until there is a draft to speak
 * of, then one quiet eyebrow line in the header: the affirm tick is the "your
 * work is safe" the exit dialog used to have to deny.
 */
function DraftStatus({ state }: { state: DraftSaveState }) {
  return (
    <p
      aria-live="polite"
      className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors"
    >
      {state === "saving" ? (
        <>
          <RiLoader4Line className="size-3 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Saving</span>
        </>
      ) : state === "saved" ? (
        <>
          <RiCheckLine className="size-3 text-affirm" />
          <span className="text-affirm">Draft saved</span>
        </>
      ) : (
        <>
          {/* A square dot, because nothing in this house is round. */}
          <span aria-hidden className="size-1.5 bg-caution" />
          <span className="text-muted-foreground">Unsaved</span>
        </>
      )}
    </p>
  );
}
