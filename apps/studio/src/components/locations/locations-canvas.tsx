"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import {
  RiAddLine,
  RiLoader4Line,
  RiMapPinLine,
  RiSparkling2Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  useCreateEntity,
  useDeleteEntity,
  useEntityList,
  useUpdateEntity,
} from "@/lib/queries/entities";
import { useAiLocation } from "@/lib/queries/ai";
import {
  LocationNode,
  type LocationNodeType,
} from "@/components/flow/location-node";
import { LocationSheet } from "./location-sheet";
import type { Character, Location, LocationLink } from "@/lib/queries/types";

const nodeTypes = { location: LocationNode };

function toNode(l: Location, characters: Character[]): LocationNodeType {
  return {
    id: l.id,
    type: "location",
    position: { x: l.posX, y: l.posY },
    data: {
      location: l,
      members: characters.filter((c) => l.characterIds.includes(c.id)),
    },
  };
}

function toEdge(link: LocationLink): Edge {
  return {
    id: link.id,
    source: link.sourceLocationId,
    target: link.targetLocationId,
    label: link.label || undefined,
    type: "smoothstep",
    animated: false,
    style: { stroke: "#4a6b5c", strokeWidth: 1.5, opacity: 0.6 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#4a6b5c" },
    labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
    labelBgStyle: { fill: "var(--card)" },
  };
}

export function LocationsCanvas({ novelId }: { novelId: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<LocationNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [locationsList, setLocationsList] = useState<Location[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState<Location | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const locationsQuery = useEntityList<Location>(novelId, "locations");
  const linksQuery = useEntityList<LocationLink>(novelId, "location-links");
  const charactersQuery = useEntityList<Character>(novelId, "characters");
  const createLocation = useCreateEntity<Location>(novelId, "locations");
  const createLink = useCreateEntity<LocationLink>(novelId, "location-links");
  const updateEntity = useUpdateEntity<LocationLink>(novelId);
  const deleteEntity = useDeleteEntity(novelId);
  const suggest = useAiLocation();

  // The canvas holds its own node/edge state because dragging writes positions
  // continuously; the queries seed it and re-seed when the novel's data changes
  // underneath, which is why this stays an effect rather than derived state.
  useEffect(() => {
    const locs = locationsQuery.data;
    const links = linksQuery.data;
    const chars = charactersQuery.data;
    if (!locs || !links || !chars) return;
    setLocationsList(locs);
    setCharacters(chars);
    setNodes(locs.map((l) => toNode(l, chars)));
    setEdges(links.map(toEdge));
  }, [locationsQuery.data, linksQuery.data, charactersQuery.data, setNodes, setEdges]);

  const upsertLocation = useCallback(
    (l: Location) => {
      setLocationsList((list) => {
        const exists = list.some((x) => x.id === l.id);
        return exists ? list.map((x) => (x.id === l.id ? l : x)) : [...list, l];
      });
      setCharacters((chars) => {
        setNodes((ns) => {
          const exists = ns.some((n) => n.id === l.id);
          return exists
            ? ns.map((n) => (n.id === l.id ? toNode(l, chars) : n))
            : [...ns, toNode(l, chars)];
        });
        return chars;
      });
      setSelected((s) => (s?.id === l.id ? l : s));
    },
    [setNodes],
  );

  const onConnect = useCallback(
    async (conn: Connection) => {
      if (conn.source === conn.target) return;
      try {
        const link = await createLink.mutateAsync({
          sourceLocationId: conn.source,
          targetLocationId: conn.target,
          label: "",
        });
        setEdges((es) => [...es, toEdge(link)]);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [createLink, setEdges],
  );

  const onEdgeClick: EdgeMouseHandler<Edge> = useCallback(
    async (_e, edge) => {
      const label = window.prompt(
        "Connection label (empty to keep, '-' to delete):",
        (edge.label as string) ?? "",
      );
      if (label === null) return;
      if (label === "-") {
        await deleteEntity
          .mutateAsync({ entity: "location-links", id: edge.id })
          .catch(() => {});
        setEdges((es) => es.filter((x) => x.id !== edge.id));
        return;
      }
      const updated = await updateEntity.mutateAsync({
        entity: "location-links",
        id: edge.id,
        values: { label },
      });
      setEdges((es) =>
        es.map((x) => (x.id === edge.id ? toEdge(updated) : x)),
      );
    },
    [deleteEntity, updateEntity, setEdges],
  );

  const onNodeClick: NodeMouseHandler<LocationNodeType> = useCallback(
    (_e, node) => {
      setSelected(node.data.location);
      setSheetOpen(true);
    },
    [],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      // Fire and forget: a dropped position that fails to save is not worth
      // interrupting the author over, and the next drag will try again.
      updateEntity
        .mutateAsync({
          entity: "locations",
          id: node.id,
          values: { posX: node.position.x, posY: node.position.y },
        })
        .catch(() => {});
    },
    [updateEntity],
  );

  async function addLocation() {
    try {
      const created = await createLocation.mutateAsync({
        name: `Location ${locationsList.length + 1}`,
        posX: 120 + Math.random() * 400,
        posY: 120 + Math.random() * 300,
      });
      upsertLocation(created);
      setSelected(created);
      setSheetOpen(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function suggestLocation() {
    setAiBusy(true);
    try {
      const out = await suggest.mutateAsync({ novelId });
      const created = await createLocation.mutateAsync({
        ...out,
        origin: "ai",
        posX: 120 + Math.random() * 400,
        posY: 120 + Math.random() * 300,
      });
      upsertLocation(created);
      toast.success(`"${created.name}" added to the world`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
        <MiniMap pannable zoomable className="!bg-card" nodeColor={() => "#4a6b5c"} />
      </ReactFlow>

      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <div className="mr-2 flex items-center gap-2 text-sm font-semibold">
          <RiMapPinLine className="size-4 text-affirm" /> Locations
        </div>
        <Button size="sm" onClick={addLocation}>
          <RiAddLine className="size-4" /> Add Location
        </Button>
        <Button size="sm" variant="secondary" onClick={suggestLocation} disabled={aiBusy}>
          {aiBusy ? (
            <RiLoader4Line className="size-4 animate-spin" />
          ) : (
            <RiSparkling2Line className="size-4" />
          )}
          Suggest Location
        </Button>
      </div>

      {locationsList.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            No locations yet. Add one or let the AI dream up a setting. Drag
            between two places to draw a route.
          </p>
        </div>
      )}

      <LocationSheet
        novelId={novelId}
        location={selected}
        characters={characters}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={upsertLocation}
        onDeleted={(id) => {
          setLocationsList((l) => l.filter((x) => x.id !== id));
          setNodes((ns) => ns.filter((n) => n.id !== id));
          setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
        }}
      />
    </div>
  );
}
