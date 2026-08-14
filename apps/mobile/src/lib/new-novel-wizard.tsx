import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

import type {
  Reading,
  StyleFields,
  StyleProposal,
  WizardTurn,
  WizardUsage,
} from '@behindthestory/core/onboarding';

import { useAiOnboardingReading, useAiOnboardingStyle } from '@/lib/queries/ai-onboarding';
import { useCreateNovel, type Novel } from '@/lib/queries/novels';

/**
 * The studio wizard's state machine, lifted out of its page component so four
 * pushed screens can share it. Nothing is written to the server until
 * `create` on the last screen — closing the sheet discards everything, which
 * is exactly what the studio's exit dialog promises.
 */
type Wizard = {
  title: string;
  titleFromAi: boolean;
  setTitle: (value: string, fromAi?: boolean) => void;
  description: string;
  setDescription: (value: string) => void;
  dirty: boolean;

  reading: Reading | null;
  readingBusy: boolean;
  readingError: string | null;
  turns: WizardTurn[];
  /** Runs on entering the alignment step; re-derives from scratch each round. */
  runReading: (corrections: string[]) => Promise<Reading | null>;
  refine: (correction: string) => Promise<void>;

  style: StyleFields | null;
  styleProposal: StyleProposal | null;
  styleBusy: boolean;
  styleError: string | null;
  /** True when the reading changed after the style was derived from it. */
  styleStale: boolean;
  patchStyle: (patch: Partial<StyleFields>) => void;
  runStyle: () => Promise<void>;

  creating: boolean;
  create: () => Promise<Novel>;
};

const WizardContext = createContext<Wizard | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const readNovel = useAiOnboardingReading();
  const proposeStyle = useAiOnboardingStyle();
  const createNovel = useCreateNovel();

  const [title, setTitleState] = useState('');
  const [titleFromAi, setTitleFromAi] = useState(false);
  const [description, setDescription] = useState('');

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

  // Refs rather than the busy flags: screens kick these off on mount, and a
  // state update that has not landed yet would let a second request through.
  const inFlight = useRef({ reading: false, style: false });

  /** `fromAi` keeps the "named by AI" note honest when the author picks a
   *  suggested title instead of typing their own. */
  const setTitle = useCallback((value: string, fromAi = false) => {
    setTitleState(value);
    setTitleFromAi(fromAi);
  }, []);

  const runReading = useCallback(
    async (corrections: string[]): Promise<Reading | null> => {
      if (inFlight.current.reading) return null;
      inFlight.current.reading = true;
      setReadingBusy(true);
      setReadingError(null);
      try {
        const res = await readNovel.mutateAsync({
          title,
          description,
          corrections,
          previous: reading,
        });
        setReading(res.reading);
        setReadingRevision((r) => r + 1);
        setUsage((u) => [...u, res.usage]);
        // An untitled novel gets named here, which is also why the title stays
        // editable on the alignment step rather than only on the first one.
        if (!title.trim() && res.reading.titleSuggestions[0]) {
          setTitleState(res.reading.titleSuggestions[0]);
          setTitleFromAi(true);
        }
        return res.reading;
      } catch (e) {
        setReadingError((e as Error).message);
        return null;
      } finally {
        inFlight.current.reading = false;
        setReadingBusy(false);
      }
    },
    [title, description, reading, readNovel],
  );

  const refine = useCallback(
    async (correction: string) => {
      const result = await runReading([...turns.map((t) => t.correction), correction]);
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
      const res = await proposeStyle.mutateAsync({ title, reading });
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
      setStyleError((e as Error).message);
    } finally {
      inFlight.current.style = false;
      setStyleBusy(false);
    }
  }, [reading, readingRevision, title, proposeStyle]);

  const create = useCallback(async (): Promise<Novel> => {
    if (!reading || !style) throw new Error('The wizard is not finished yet.');
    setCreating(true);
    try {
      return await createNovel.mutateAsync({
        title: title.trim(),
        premise: reading.premise,
        ...style,
        aiUsage: usage,
      });
    } finally {
      setCreating(false);
    }
  }, [reading, style, title, usage, createNovel]);

  const value: Wizard = {
    title,
    titleFromAi,
    setTitle,
    description,
    setDescription,
    dirty: description.trim().length > 0 || title.trim().length > 0,
    reading,
    readingBusy,
    readingError,
    turns,
    runReading,
    refine,
    style,
    styleProposal,
    styleBusy,
    styleError,
    styleStale: style !== null && styleFrom !== readingRevision,
    patchStyle: (patch) => setStyle((s) => (s ? { ...s, ...patch } : s)),
    runStyle,
    creating,
    create,
  };

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): Wizard {
  const wizard = useContext(WizardContext);
  if (!wizard) throw new Error('useWizard must be used inside WizardProvider');
  return wizard;
}
