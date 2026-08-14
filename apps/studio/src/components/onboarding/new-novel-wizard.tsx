"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { api } from "@/lib/api";
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
  type WizardUsage,
} from "@/lib/onboarding";
import type { Novel } from "@/db/schema";
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

export function NewNovelWizard() {
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);

  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);

  const [title, setTitle] = useState("");
  const [titleFromAi, setTitleFromAi] = useState(false);
  const [description, setDescription] = useState("");

  const [reading, setReading] = useState<Reading | null>(null);
  const [readingRevision, setReadingRevision] = useState(0);
  const [readingBusy, setReadingBusy] = useState(false);
  const [readingError, setReadingError] = useState<string | null>(null);
  const [turns, setTurns] = useState<WizardTurn[]>([]);

  const [style, setStyle] = useState<StyleFields | null>(null);
  const [styleProposal, setStyleProposal] = useState<StyleProposal | null>(null);
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);
  /** Which reading revision the current style was derived from. */
  const [styleFrom, setStyleFrom] = useState(-1);

  const [usage, setUsage] = useState<WizardUsage[]>([]);
  const [creating, setCreating] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);

  // Refs rather than the busy flags: the effects below fire on step entry, and
  // a state update that has not landed yet would let a second request through.
  const inFlight = useRef({ reading: false, style: false });

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
        const res = await api.post<ReadingResponse>(
          "/api/ai/onboarding/reading",
          body,
        );
        setReading(res.reading);
        setReadingRevision((r) => r + 1);
        setUsage((u) => [...u, res.usage]);
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
      const res = await api.post<StyleResponse>(
        "/api/ai/onboarding/style",
        body,
      );
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
      setUsage((u) => [...u, res.usage]);
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

  /** `fromAi` is what keeps the "named by AI" badge honest when the author picks
   *  one of the suggested titles instead of typing their own. */
  const changeTitle = useCallback((value: string, fromAi = false) => {
    setTitle(value);
    setTitleFromAi(fromAi);
  }, []);

  const create = useCallback(async () => {
    if (!reading || !style || creating) return;
    setCreating(true);
    try {
      const novel = await api.post<Novel>("/api/novels", {
        title: title.trim(),
        premise: reading.premise,
        ...style,
        aiUsage: usage,
      });
      toast.success(`“${novel.title}” is ready`);
      router.push(`/novels/${novel.id}/bible`);
    } catch (e) {
      toast.error((e as Error).message);
      setCreating(false);
    }
  }, [reading, style, creating, title, usage, router]);

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
          : "Nothing has been saved yet.";

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
            <AlertDialogTitle>Leave without creating?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing has been saved yet, so this premise and everything the AI
              worked out from it will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction onClick={() => router.push("/")}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
