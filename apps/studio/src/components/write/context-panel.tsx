"use client";

import { RiMapPinLine, RiUserLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { elementStyles } from "@/components/flow/element-node";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { Character, Location, StoryElement } from "@/lib/queries/types";

export type ContextSelection = {
  characterIds: Set<string>;
  locationIds: Set<string>;
  elementIds: Set<string>;
};

type Props = {
  characters: Character[];
  locations: Location[];
  elements: StoryElement[];
  selection: ContextSelection;
  onToggle: (
    kind: "character" | "location" | "element",
    id: string,
  ) => void;
};

export function ContextPanel({
  characters,
  locations,
  elements,
  selection,
  onToggle,
}: Props) {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase();

  const chars = characters.filter((c) => c.name.toLowerCase().includes(q));
  const locs = locations.filter((l) => l.name.toLowerCase().includes(q));
  const elems = elements.filter((e) => e.title.toLowerCase().includes(q));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <h2 className="text-sm font-medium">Notes & sources</h2>
        <p className="mt-1 text-base/7 text-muted-foreground sm:text-sm/6">
          Story context is built automatically. Pin something only when it must
          be emphasized for the next suggestion.
        </p>
        <Input
          name="source-filter"
          aria-label="Filter story sources"
          className="mt-3 h-9 sm:h-8 max-sm:text-base"
          placeholder="Find a character, place, or thread"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <section>
            <h3 className="label-caps mb-1.5 flex items-center gap-1.5">
              <RiUserLine className="size-4 shrink-0" /> Characters
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {chars.map((c) => (
                <Badge
                  key={c.id}
                  asChild
                  variant={
                    selection.characterIds.has(c.id) ? "default" : "outline"
                  }
                  className="cursor-pointer select-none"
                  style={
                    selection.characterIds.has(c.id)
                      ? { backgroundColor: c.color, color: "white" }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => onToggle("character", c.id)}
                    aria-pressed={selection.characterIds.has(c.id)}
                  >
                    {c.name}
                  </button>
                </Badge>
              ))}
              {chars.length === 0 && (
                <p className="text-base/7 text-muted-foreground sm:text-sm/6">
                  None.
                </p>
              )}
            </div>
          </section>

          <section>
            <h3 className="label-caps mb-1.5 flex items-center gap-1.5">
              <RiMapPinLine className="size-4 shrink-0" /> Locations
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {locs.map((l) => (
                <Badge
                  key={l.id}
                  asChild
                  variant={
                    selection.locationIds.has(l.id) ? "default" : "outline"
                  }
                  className="cursor-pointer select-none"
                >
                  <button
                    type="button"
                    onClick={() => onToggle("location", l.id)}
                    aria-pressed={selection.locationIds.has(l.id)}
                  >
                    {l.name}
                  </button>
                </Badge>
              ))}
              {locs.length === 0 && (
                <p className="text-base/7 text-muted-foreground sm:text-sm/6">
                  None.
                </p>
              )}
            </div>
          </section>

          <section>
            <h3 className="label-caps mb-1.5">
              Twists · Foreshadowing · Threads
            </h3>
            <div className="space-y-1.5">
              {elems.map((e) => {
                const style = elementStyles[e.type];
                const active = selection.elementIds.has(e.id);
                return (
                  <button
                    type="button"
                    key={e.id}
                    onClick={() => onToggle("element", e.id)}
                    className={cn(
                      "w-full rounded-lg border p-2.5 text-left",
                      active
                        ? "border-primary/60 bg-primary/10"
                        : "border-border bg-card/40 hover:bg-accent",
                    )}
                  >
                    <p
                      className="label-caps"
                      style={{ color: style.color }}
                    >
                      {style.label} · {e.status}
                    </p>
                    <p className="text-base/7 font-medium sm:text-sm/6">
                      {e.title}
                    </p>
                  </button>
                );
              })}
              {elems.length === 0 && (
                <p className="text-base/7 text-muted-foreground sm:text-sm/6">
                  Nothing extracted yet — analyze a chapter to build story
                  memory.
                </p>
              )}
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
