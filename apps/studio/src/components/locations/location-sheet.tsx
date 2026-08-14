"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RiDeleteBinLine, RiLoader4Line, RiSparkling2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Character, Location } from "@behindthestory/db/schema";

type Props = {
  novelId: string;
  location: Location | null;
  characters: Character[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (l: Location) => void;
  onDeleted: (id: string) => void;
};

export function LocationSheet({
  novelId,
  location,
  characters,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: Props) {
  const [form, setForm] = useState<Partial<Location>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (location) setForm(location);
  }, [location]);

  if (!location) return null;

  const set = (patch: Partial<Location>) =>
    setForm((f) => ({ ...f, ...patch }));

  const memberIds = new Set(form.characterIds ?? []);

  function toggleMember(id: string) {
    const next = new Set(memberIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ characterIds: [...next] });
  }

  async function save() {
    if (!location) return;
    setSaving(true);
    try {
      const updated = await api.patch<Location>(
        `/api/entities/locations/${location.id}`,
        {
          name: form.name,
          description: form.description,
          atmosphere: form.atmosphere,
          significance: form.significance,
          characterIds: form.characterIds ?? [],
        },
      );
      onSaved(updated);
      toast.success("Location saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function fillWithAI() {
    if (!location) return;
    setAiBusy(true);
    try {
      const out = await api.post<{
        name: string;
        description: string;
        atmosphere: string;
        significance: string;
      }>("/api/ai/location", { novelId, locationId: location.id });
      set({
        description: out.description,
        atmosphere: out.atmosphere,
        significance: out.significance,
      });
      toast.success("AI draft ready — review and save");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  async function remove() {
    if (!location) return;
    try {
      await api.del(`/api/entities/locations/${location.id}`);
      onDeleted(location.id);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[400px] flex-col gap-0 sm:max-w-[400px]">
        <SheetHeader className="border-b">
          <SheetTitle>{form.name || location.name}</SheetTitle>
          <SheetDescription>
            {location.origin === "ai" ? "AI-created location" : "Location"}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name ?? ""}
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Atmosphere</Label>
              <Input
                value={form.atmosphere ?? ""}
                onChange={(e) => set({ atmosphere: e.target.value })}
                placeholder="rain-slicked neon streets, hushed dread"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={6}
                value={form.description ?? ""}
                onChange={(e) => set({ description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Significance</Label>
              <Textarea
                rows={3}
                value={form.significance ?? ""}
                onChange={(e) => set({ significance: e.target.value })}
                placeholder="Why this place matters to the story..."
              />
            </div>
            <div className="space-y-2">
              <Label>Connected characters</Label>
              <div className="flex flex-wrap gap-1.5">
                {characters.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No characters in this novel yet.
                  </p>
                )}
                {characters.map((c) => (
                  <Badge
                    key={c.id}
                    variant={memberIds.has(c.id) ? "default" : "outline"}
                    className={cn("cursor-pointer select-none")}
                    onClick={() => toggleMember(c.id)}
                  >
                    {c.name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center gap-2 border-t p-4">
          <Button onClick={save} disabled={saving} className="flex-1">
            {saving ? <RiLoader4Line className="size-4 animate-spin" /> : "Save"}
          </Button>
          <Button variant="secondary" onClick={fillWithAI} disabled={aiBusy}>
            {aiBusy ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiSparkling2Line className="size-4" />
            )}
            Fill with AI
          </Button>
          <Button variant="ghost" size="icon" onClick={remove}>
            <RiDeleteBinLine className="size-4 text-destructive" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
