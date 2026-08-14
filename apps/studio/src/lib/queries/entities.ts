"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiError } from "@/lib/query-client";
import { rpc } from "@/lib/rpc";

/**
 * The generic entity routes serve nine tables through one path, so the server's
 * response type is a union of all of them. The entity name is what decides
 * which member you get, and the caller always knows it — so these hooks take
 * the row type as a parameter and narrow the union at the boundary.
 *
 * That cast is the same one the API makes on its side, for the same reason: the
 * registry is where the name→table mapping lives, and neither end can express
 * it in the type system without duplicating the map.
 */
export type NovelEntity =
  | "characters"
  | "locations"
  | "location-links"
  | "chapters"
  | "story-elements"
  | "character-facts";

/** Everything reachable by id, including the two that have no list route. */
export type Entity = NovelEntity | "relationships" | "story-events" | "chapter-revisions";

function entityKey(novelId: string, entity: NovelEntity) {
  return ["novels", novelId, entity] as const;
}

export function useEntityList<T>(
  novelId: string,
  entity: NovelEntity,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: entityKey(novelId, entity),
    queryFn: async () => {
      const res = await rpc.api.novels[":novelId"][":entity"].$get({
        param: { novelId, entity },
      });
      if (!res.ok) throw await apiError(res);
      return (await res.json()) as T[];
    },
    enabled: (options?.enabled ?? true) && Boolean(novelId),
  });
}

export function useCreateEntity<T>(novelId: string, entity: NovelEntity) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const res = await rpc.api.novels[":novelId"][":entity"].$post({
        param: { novelId, entity },
        // The route reads the body untyped — it is shaped by the chosen entity.
        json: values as never,
      });
      if (!res.ok) throw await apiError(res);
      return (await res.json()) as T;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: entityKey(novelId, entity) }),
  });
}

/**
 * Update and delete take the entity name per call rather than per hook: a single
 * screen often edits a character and its facts, and binding one hook to one
 * table would mean three hooks where one reads better.
 */
export function useUpdateEntity<T>(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      entity: Entity;
      id: string;
      values: Record<string, unknown>;
    }) => {
      const res = await rpc.api.entities[":entity"][":id"].$patch({
        param: { entity: input.entity, id: input.id },
        json: input.values as never,
      });
      if (!res.ok) throw await apiError(res);
      return (await res.json()) as T;
    },
    // Which table changed is known, but a change to a character can move a
    // relationship's label and a chapter's spine; invalidating the novel is
    // both correct and cheap next to reasoning about every dependency.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
  });
}

export function useDeleteEntity(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entity: Entity; id: string }) => {
      const res = await rpc.api.entities[":entity"][":id"].$delete({
        param: { entity: input.entity, id: input.id },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
  });
}

/**
 * A one-off read by id, outside the cache.
 *
 * Used where a row is fetched in response to a click and thrown away again —
 * previewing a revision, resolving a chapter before restoring it. Wrapping
 * those in `useQuery` would mean a hook per possible id.
 */
export async function fetchEntity<T>(entity: Entity, id: string): Promise<T> {
  const res = await rpc.api.entities[":entity"][":id"].$get({
    param: { entity, id },
  });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

/**
 * An imperative list read.
 *
 * The writing studio loads eight collections as one coordinated snapshot and
 * only shows the editor once they have all arrived, because the prose refs are
 * seeded from the same batch. Splitting that into eight independent queries
 * would let the editor mount against a half-populated screen, so it keeps the
 * batch and takes the typed transport.
 */
export async function fetchEntityList<T>(
  novelId: string,
  entity: NovelEntity,
): Promise<T[]> {
  const res = await rpc.api.novels[":novelId"][":entity"].$get({
    param: { novelId, entity },
  });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T[];
}
