"use client";

import { useState } from "react";
import { RiAddLine, RiCloseLine } from "@remixicon/react";

import { GENRE_SUGGESTIONS, PROFILE_LIMITS } from "@behindthestory/core/profile";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * The genres someone reads, as a small set of chosen things rather than a
 * comma-separated line of text.
 *
 * The suggestions are a shortcut, not a taxonomy: the field accepts anything
 * typed into it, because a writer whose genre is not on a list of fourteen
 * should not be told their genre does not exist. What the list buys is that the
 * common answers are spelled the same way across accounts, which is what makes
 * them worth matching on later.
 */
export function GenreField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const full = value.length >= PROFILE_LIMITS.favoriteGenres;

  const has = (genre: string) =>
    value.some((existing) => existing.toLowerCase() === genre.toLowerCase());

  function add(genre: string) {
    const clean = genre.trim().slice(0, PROFILE_LIMITS.genreLength);
    if (!clean || full || has(clean)) return;
    onChange([...value, clean]);
    setDraft("");
  }

  const unused = GENRE_SUGGESTIONS.filter((genre) => !has(genre));

  return (
    <div className="space-y-3">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((genre) => (
            <li key={genre}>
              <span className="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/10 py-1 pr-1 pl-2.5 text-xs font-medium text-primary">
                {genre}
                <button
                  type="button"
                  aria-label={`Remove ${genre}`}
                  className="inline-flex size-4 items-center justify-center text-primary/70 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() =>
                    onChange(value.filter((existing) => existing !== genre))
                  }
                >
                  <RiCloseLine className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!full ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add(draft);
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={PROFILE_LIMITS.genreLength}
            placeholder="Add a genre"
            className="max-w-56"
            aria-label="Add a genre"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Add genre"
            className="inline-flex size-8 shrink-0 items-center justify-center border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            <RiAddLine className="size-4" />
          </button>
        </form>
      ) : null}

      {unused.length > 0 && !full ? (
        <div className="flex flex-wrap gap-1.5">
          {unused.map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() => add(genre)}
              className={cn(
                "border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors",
                "hover:border-primary/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              )}
            >
              {genre}
            </button>
          ))}
        </div>
      ) : null}

      {/* Only when it is full, because only then is there something to do about
          it. "Up to 6" is not news to somebody who has picked two. */}
      {full ? (
        <p className="text-xs text-muted-foreground">
          That is all {PROFILE_LIMITS.favoriteGenres} — remove one to add
          another.
        </p>
      ) : null}
    </div>
  );
}
