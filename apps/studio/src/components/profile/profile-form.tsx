"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  PROFILE_LIMITS,
  POV_PREFERENCE_OPTIONS,
  WRITING_GOAL_OPTIONS,
} from "@behindthestory/core/profile";
import { normalizeUsername, usernameProblem } from "@behindthestory/core/username";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { AvatarField } from "@/components/profile/avatar-field";
import { EmailField } from "@/components/profile/email-field";
import { GenreField } from "@/components/profile/genre-field";
import { HandleField } from "@/components/profile/handle-field";
import {
  useProfile,
  useUpdateProfile,
  type Profile,
  type ProfileInput,
} from "@/lib/queries/profile";

/** The editable half of the profile, as the form holds it. */
type Draft = ProfileInput;

function draftFrom(profile: Profile): Draft {
  return {
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio,
    favoriteGenres: profile.favoriteGenres,
    preferredPov: profile.preferredPov,
    writingGoal: profile.writingGoal,
    influences: profile.influences,
    avoids: profile.avoids,
  };
}

export function ProfileForm() {
  const profile = useProfile();

  if (profile.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (profile.error || !profile.data) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 p-6">
        <p className="font-medium text-destructive">
          Your profile could not be loaded.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile.error?.message}
        </p>
      </div>
    );
  }

  // Keyed on the saved row so a change landing from elsewhere — the email flow
  // below, another tab — reseeds the form instead of leaving a stale draft
  // sitting on top of it.
  return <Editor key={profile.data.username} profile={profile.data} />;
}

function Editor({ profile }: { profile: Profile }) {
  const save = useUpdateProfile();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(profile));

  const saved = useMemo(() => draftFrom(profile), [profile]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );

  const handleProblem = usernameProblem(normalizeUsername(draft.username));
  const canSave = dirty && !handleProblem && !save.isPending;

  function set<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submit() {
    save.mutate(
      { ...draft, username: normalizeUsername(draft.username) },
      {
        onSuccess: () => toast.success("Profile saved."),
        onError: (cause) => toast.error(cause.message),
      },
    );
  }

  return (
    <form
      className="space-y-6 pb-24"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) submit();
      }}
    >
      <Section title="You">
        <AvatarField profile={profile} />

        <div className="space-y-1.5">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            value={draft.displayName}
            onChange={(event) => set("displayName", event.target.value)}
            maxLength={PROFILE_LIMITS.displayName}
            // The placeholder is the handle, which is the whole of what a note
            // saying "your handle is used when this is empty" would have said.
            placeholder={profile.username}
            className="max-w-sm"
          />
        </div>

        <HandleField
          value={draft.username}
          onChange={(next) => set("username", next)}
          current={profile.username}
        />

        <Field
          id="bio"
          label="Bio"
          count={{ length: draft.bio.length, max: PROFILE_LIMITS.bio }}
        >
          <Textarea
            id="bio"
            value={draft.bio}
            onChange={(event) => set("bio", event.target.value)}
            maxLength={PROFILE_LIMITS.bio}
            rows={4}
            placeholder="What you write, and what you are working on."
          />
        </Field>
      </Section>

      <Section title="Email">
        <EmailField profile={profile} />
      </Section>

      <Section title="Your taste">
        <div className="space-y-1.5">
          <Label>Which genres do you read?</Label>
          <GenreField
            value={draft.favoriteGenres}
            onChange={(next) => set("favoriteGenres", next)}
          />
        </div>

        <ChoiceField
          label="Which narrator do you reach for?"
          value={draft.preferredPov}
          onChange={(next) => set("preferredPov", next)}
          options={POV_PREFERENCE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />

        <ChoiceField
          label="What are you after right now?"
          value={draft.writingGoal}
          onChange={(next) => set("writingGoal", next)}
          options={WRITING_GOAL_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            hint: option.hint,
          }))}
        />

        <Field
          id="influences"
          label="Who shaped the way you write?"
          count={{
            length: draft.influences.length,
            max: PROFILE_LIMITS.influences,
          }}
        >
          <Textarea
            id="influences"
            value={draft.influences}
            onChange={(event) => set("influences", event.target.value)}
            maxLength={PROFILE_LIMITS.influences}
            rows={3}
            placeholder="Authors, books, films — whatever you measure your own prose against."
          />
        </Field>

        <Field
          id="avoids"
          label="What do you keep out of your prose?"
          count={{ length: draft.avoids.length, max: PROFILE_LIMITS.avoids }}
        >
          <Textarea
            id="avoids"
            value={draft.avoids}
            onChange={(event) => set("avoids", event.target.value)}
            maxLength={PROFILE_LIMITS.avoids}
            rows={3}
            placeholder="Clichés, tics, whole tropes — the things you cut on every pass."
          />
        </Field>
      </Section>

      {/* The bar appears only once there is something to save. A permanently
          visible Save button on a long form asks the writer to keep deciding
          whether they have changed anything; this answers it for them. */}
      <div
        aria-hidden={!dirty}
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t bg-background transition-transform duration-200 ease-out lg:left-60",
          dirty ? "translate-y-0" : "pointer-events-none translate-y-full",
        )}
      >
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="text-sm text-muted-foreground">
            {handleProblem ? "Fix the handle to save." : "Unsaved changes."}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => setDraft(draftFrom(profile))}
            >
              Discard
            </Button>
            <Button type="submit" disabled={!canSave}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

/**
 * A group of fields under a heading, and nothing else.
 *
 * There used to be a note under every one of these. All three were either the
 * heading again in longer words or an explanation of why the field exists —
 * which is a thing to write in a comment, not on a settings page. The labels
 * and placeholders carry it.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-5 border bg-card/40 p-5">
      <h2 className="font-heading text-base font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A labelled control with a character count that only appears near the limit. */
function Field({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count: { length: number; max: number };
  children: ReactNode;
}) {
  const near = count.length > count.max * 0.8;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {near ? (
          <span
            className={cn(
              "text-xs tabular-nums",
              count.length >= count.max ? "text-caution" : "text-muted-foreground",
            )}
          >
            {count.length}/{count.max}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A small set of options, one or none.
 *
 * Rendered as a row of toggles rather than a `<select>`: there are three to
 * five choices and they are worth reading at a glance. Re-clicking the chosen
 * one clears it, which is how "no preference" gets expressed without adding a
 * "No preference" option that would read as an answer — and without a line of
 * text under every group explaining that blank is allowed. Nothing is marked
 * required here, so blank is visibly already allowed.
 */
function ChoiceField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | null;
  onChange: (next: T | null) => void;
  options: { value: T; label: string; hint?: string }[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              title={option.hint}
              onClick={() => onChange(active ? null : option.value)}
              className={cn(
                "border px-3 py-1.5 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "border-primary/40 bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
