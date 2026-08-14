"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiBookLine,
  RiMapPinLine,
  RiSearchLine,
  RiSparkling2Line,
  RiUserLine,
} from "@remixicon/react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { api } from "@/lib/api";
import type { SearchHit } from "@behindthestory/api/type";

const GROUPS: { kind: SearchHit["kind"]; label: string; icon: typeof RiUserLine }[] = [
  { kind: "chapter", label: "Manuscript", icon: RiBookLine },
  { kind: "character", label: "Characters", icon: RiUserLine },
  { kind: "fact", label: "Established facts", icon: RiUserLine },
  { kind: "location", label: "Locations", icon: RiMapPinLine },
  { kind: "element", label: "Threads", icon: RiSparkling2Line },
];

/**
 * Novel-wide search, opened with ⌘K. "Where did I mention the broken seal?"
 * is the question a novelist asks constantly while drafting.
 */
export function ManuscriptSearch({ novelId }: { novelId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get<{ hits: SearchHit[] }>(
          `/api/novels/${novelId}/search?q=${encodeURIComponent(query.trim())}`,
        )
        .then((res) => setHits(res.hits))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => clearTimeout(timer);
  }, [query, open, novelId]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 border bg-background/50 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
      >
        <RiSearchLine className="size-3.5" />
        <span className="flex-1">Search novel</span>
        <kbd className="rounded border px-1 text-[10px]">⌘K</kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search this novel"
        description="Prose, cast, places and threads"
      >
        {/* Ranking comes from the server, so cmdk must not re-filter. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search the manuscript, cast, places and threads..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
          {query.trim().length < 2 ? (
            <CommandEmpty>Type at least two characters.</CommandEmpty>
          ) : searching && hits.length === 0 ? (
            <CommandEmpty>Searching...</CommandEmpty>
          ) : hits.length === 0 ? (
            <CommandEmpty>No matches in this novel.</CommandEmpty>
          ) : (
            GROUPS.map(({ kind, label, icon: Icon }) => {
              const group = hits.filter((h) => h.kind === kind);
              if (group.length === 0) return null;
              return (
                <CommandGroup key={kind} heading={label}>
                  {group.map((hit) => (
                    <CommandItem
                      key={`${hit.kind}-${hit.id}`}
                      value={`${hit.kind}-${hit.id}`}
                      onSelect={() => {
                        setOpen(false);
                        router.push(hit.href);
                      }}
                      className="items-start gap-2.5"
                    >
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-xs font-medium">
                            {hit.title}
                          </span>
                          {hit.subtitle && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {hit.subtitle}
                            </span>
                          )}
                        </div>
                        {hit.snippet && (
                          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                            {hit.snippet}
                          </p>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })
          )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
