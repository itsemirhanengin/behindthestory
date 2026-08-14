"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { RiAddLine, RiMindMap, RiSparkling2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  CharacterNode,
  type CharacterNodeType,
} from "@/components/flow/character-node";
import {
  RelationshipEdge,
  type RelationshipEdgeType,
} from "@/components/flow/relationship-edge";
import { CharacterSheet } from "./character-sheet";
import {
  RelationshipDialog,
  type RelationshipDraft,
} from "./relationship-dialog";
import { AiCharacterDialog, InferRelationshipsDialog } from "./ai-dialogs";
import { ChapterScrubber } from "./chapter-scrubber";
import {
  allTransitions,
  characterStateAsOf,
  eventsByCharacter,
  eventsByRelationship,
  relationshipStateAsOf,
} from "@behindthestory/core/story-state";
import type {
  Chapter,
  Character,
  Relationship,
  StoryEvent,
} from "@behindthestory/db/schema";

const nodeTypes = { character: CharacterNode };
const edgeTypes = { relationship: RelationshipEdge };

export function CharactersCanvas({ novelId }: { novelId: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CharacterNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationshipEdgeType>(
    [],
  );
  const [characters, setCharacters] = useState<Character[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [events, setEvents] = useState<StoryEvent[]>([]);
  const [spine, setSpine] = useState<Chapter[]>([]);
  const [selected, setSelected] = useState<Character | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [relTarget, setRelTarget] = useState<
    Relationship | RelationshipDraft | null
  >(null);
  const [aiCharOpen, setAiCharOpen] = useState(false);
  const [inferOpen, setInferOpen] = useState(false);
  /** The chapter whose state is on screen. Null until the spine is known. */
  const [asOf, setAsOf] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Character[]>(`/api/novels/${novelId}/characters`),
      api.get<Relationship[]>(`/api/novels/${novelId}/relationships`),
      api.get<StoryEvent[]>(`/api/novels/${novelId}/story-events`),
      api.get<Chapter[]>(`/api/novels/${novelId}/chapters`),
    ])
      .then(([chars, rels, evts, chaps]) => {
        setCharacters(chars);
        setRelationships(rels);
        setEvents(evts);
        setSpine(chaps.filter((ch) => ch.isActive));
      })
      .catch((e) => toast.error(e.message));
  }, [novelId]);

  const lastChapter = useMemo(
    () => spine.reduce((max, ch) => Math.max(max, ch.number), 1),
    [spine],
  );

  // Until the author scrubs, the canvas tracks the end of the novel — which is
  // what they expect on arrival, and keeps following the spine as it grows.
  const view = asOf ?? lastChapter;

  const relEventsById = useMemo(() => eventsByRelationship(events), [events]);
  const charEventsById = useMemo(() => eventsByCharacter(events), [events]);

  /** Chapters where anything changed — the scrubber's tick marks. */
  const changedAt = useMemo(
    () => [...new Set(events.map((e) => e.chapterNumber))].filter((n) => n > 0),
    [events],
  );

  const reload = useCallback(() => {
    Promise.all([
      api.get<Relationship[]>(`/api/novels/${novelId}/relationships`),
      api.get<StoryEvent[]>(`/api/novels/${novelId}/story-events`),
    ])
      .then(([rels, evts]) => {
        setRelationships(rels);
        setEvents(evts);
      })
      .catch((e) => toast.error(e.message));
  }, [novelId]);

  // --- Derivation: nodes keep their positions, state is patched in ----------
  // Positions live on the node objects because dragging mutates them, so this
  // patches `data` in place rather than rebuilding — a rebuild would snap a
  // just-dragged card back to its last loaded position.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      return characters.map((c) => {
        const existing = byId.get(c.id);
        const state = characterStateAsOf(charEventsById.get(c.id) ?? [], view);
        return existing
          ? { ...existing, data: { character: c, state } }
          : {
              id: c.id,
              type: "character" as const,
              position: { x: c.posX, y: c.posY },
              data: { character: c, state },
            };
      });
    });
  }, [characters, charEventsById, view, setNodes]);

  // Edges are rebuilt: a bond can genuinely appear or disappear as the chapter
  // moves, and they carry no position to preserve.
  useEffect(() => {
    setEdges(
      relationships.flatMap((r) => {
        const own = relEventsById.get(r.id) ?? [];
        const state = relationshipStateAsOf(own, view);
        if (!state) return []; // not formed yet at this chapter
        const turnCount = allTransitions(own, view).filter((s) => s.isTurn)
          .length;
        return [
          {
            id: r.id,
            type: "relationship" as const,
            source: r.sourceCharacterId,
            target: r.targetCharacterId,
            data: { relationship: r, state, turnCount },
          },
        ];
      }),
    );
  }, [relationships, relEventsById, view, setEdges]);

  const upsertCharacter = useCallback((c: Character) => {
    setCharacters((list) => {
      const exists = list.some((x) => x.id === c.id);
      return exists ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c];
    });
    setSelected((s) => (s?.id === c.id ? c : s));
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    if (conn.source === conn.target) return;
    setRelTarget({
      sourceCharacterId: conn.source,
      targetCharacterId: conn.target,
    });
  }, []);

  const onNodeClick: NodeMouseHandler<CharacterNodeType> = useCallback(
    (_e, node) => {
      setSelected(node.data.character);
      setSheetOpen(true);
    },
    [],
  );

  const onEdgeClick: EdgeMouseHandler<RelationshipEdgeType> = useCallback(
    (_e, edge) => {
      if (edge.data) setRelTarget(edge.data.relationship);
    },
    [],
  );

  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    // Mirror the move into local state as well as the database: the derivation
    // effect above reads positions from the nodes, but a character reloaded
    // from `characters` would otherwise carry the stale coordinates.
    setCharacters((list) =>
      list.map((c) =>
        c.id === node.id
          ? { ...c, posX: node.position.x, posY: node.position.y }
          : c,
      ),
    );
    api
      .patch(`/api/entities/characters/${node.id}`, {
        posX: node.position.x,
        posY: node.position.y,
      })
      .catch(() => {});
  }, []);

  async function addCharacter() {
    try {
      const created = await api.post<Character>(
        `/api/novels/${novelId}/characters`,
        {
          name: `Character ${characters.length + 1}`,
          posX: 120 + Math.random() * 400,
          posY: 120 + Math.random() * 300,
        },
      );
      upsertCharacter(created);
      setSelected(created);
      setSheetOpen(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const empty = characters.length === 0;
  const hiddenBonds = relationships.length - edges.length;

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeDragStop={onNodeDragStop}
        fitView
        // The palette comes from our tokens (see `.react-flow` in globals.css);
        // "dark" here would let React Flow re-theme this subtree.
        colorMode="light"
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          className="!bg-card"
          nodeColor={(n) =>
            (n as CharacterNodeType).data?.character?.color ?? "#666"
          }
        />
      </ReactFlow>

      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <div className="mr-2 flex items-center gap-2 text-sm font-semibold">
          <RiMindMap className="size-4 text-primary" /> Characters
        </div>
        <Button size="sm" onClick={addCharacter}>
          <RiAddLine className="size-4" /> Add Character
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAiCharOpen(true)}>
          <RiSparkling2Line className="size-4" /> Suggest Character
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setInferOpen(true)}
          disabled={characters.length < 2}
        >
          <RiSparkling2Line className="size-4" /> Infer Relationships
        </Button>
      </div>

      <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-1.5">
        <ChapterScrubber
          value={view}
          max={lastChapter}
          changedAt={changedAt}
          onChange={setAsOf}
        />
        {hiddenBonds > 0 && (
          <p className="border bg-card px-2 py-1 text-[11px] text-muted-foreground">
            {hiddenBonds} bond{hiddenBonds > 1 ? "s" : ""} not formed yet at this
            chapter
          </p>
        )}
      </div>

      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            No characters yet. Add one manually or let the AI suggest a cast
            member. Drag between two cards to map a relationship.
          </p>
        </div>
      )}

      <CharacterSheet
        novelId={novelId}
        character={selected}
        relationships={relationships}
        characters={characters}
        events={events}
        asOf={view}
        lastChapter={lastChapter}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={upsertCharacter}
        onEventsChanged={reload}
        onDeleted={(id) => {
          setCharacters((l) => l.filter((c) => c.id !== id));
          setRelationships((l) =>
            l.filter(
              (r) => r.sourceCharacterId !== id && r.targetCharacterId !== id,
            ),
          );
          setEvents((l) =>
            l.filter(
              (e) =>
                e.characterId !== id &&
                !relationships.some(
                  (r) =>
                    r.id === e.relationshipId &&
                    (r.sourceCharacterId === id || r.targetCharacterId === id),
                ),
            ),
          );
        }}
      />

      <RelationshipDialog
        novelId={novelId}
        characters={characters}
        events={events}
        target={relTarget}
        asOf={view}
        lastChapter={lastChapter}
        onOpenChange={(o) => !o && setRelTarget(null)}
        onChanged={reload}
        onDeleted={(id) => {
          setRelationships((l) => l.filter((r) => r.id !== id));
          setEvents((l) => l.filter((e) => e.relationshipId !== id));
        }}
      />

      <AiCharacterDialog
        novelId={novelId}
        open={aiCharOpen}
        onOpenChange={setAiCharOpen}
        onAccepted={upsertCharacter}
      />

      <InferRelationshipsDialog
        novelId={novelId}
        characters={characters}
        open={inferOpen}
        onOpenChange={setInferOpen}
        onAccepted={reload}
      />
    </div>
  );
}
