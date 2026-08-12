"use client";

import { MapPin, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { elementStyles } from "@/components/flow/element-node";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { Character, Location, StoryElement } from "@/db/schema";

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
        <h3 className="text-sm font-semibold">Story Context</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          Selected items are fed to the AI in full detail. Type @ in the editor
          for quick mentions.
        </p>
        <Input
          className="mt-2 h-8"
          placeholder="Filter..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <section>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <User className="size-3" /> Characters
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {chars.map((c) => (
                <Badge
                  key={c.id}
                  variant={
                    selection.characterIds.has(c.id) ? "default" : "outline"
                  }
                  className="cursor-pointer select-none"
                  style={
                    selection.characterIds.has(c.id)
                      ? { backgroundColor: c.color, color: "white" }
                      : undefined
                  }
                  onClick={() => onToggle("character", c.id)}
                >
                  {c.name}
                </Badge>
              ))}
              {chars.length === 0 && (
                <span className="text-[11px] text-muted-foreground">none</span>
              )}
            </div>
          </section>

          <section>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <MapPin className="size-3" /> Locations
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {locs.map((l) => (
                <Badge
                  key={l.id}
                  variant={
                    selection.locationIds.has(l.id) ? "default" : "outline"
                  }
                  className="cursor-pointer select-none"
                  onClick={() => onToggle("location", l.id)}
                >
                  {l.name}
                </Badge>
              ))}
              {locs.length === 0 && (
                <span className="text-[11px] text-muted-foreground">none</span>
              )}
            </div>
          </section>

          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Twists · Foreshadowing · Threads
            </h4>
            <div className="space-y-1.5">
              {elems.map((e) => {
                const style = elementStyles[e.type];
                const active = selection.elementIds.has(e.id);
                return (
                  <button
                    key={e.id}
                    onClick={() => onToggle("element", e.id)}
                    className={cn(
                      "w-full rounded-md border p-2 text-left transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10"
                        : "border-border bg-card/40 hover:bg-accent",
                    )}
                  >
                    <span
                      className="text-[9px] font-semibold uppercase"
                      style={{ color: style.color }}
                    >
                      {style.label} · {e.status}
                    </span>
                    <p className="text-xs font-medium">{e.title}</p>
                  </button>
                );
              })}
              {elems.length === 0 && (
                <span className="text-[11px] text-muted-foreground">
                  Nothing extracted yet — analyze a chapter to build story
                  memory.
                </span>
              )}
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
