"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";

import { apiError } from "@/lib/query-client";
import { keys } from "@/lib/queries/keys";
import { rpc } from "@/lib/rpc";

export function useRelationships(novelId: string) {
  return useQuery({
    queryKey: keys.relationships(novelId),
    queryFn: async () => {
      const res = await rpc.api.novels[":novelId"].relationships.$get({
        param: { novelId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: Boolean(novelId),
  });
}

/**
 * A bond is created together with its opening event, which is why this has its
 * own route rather than going through the generic entity create.
 */
export function useCreateRelationship(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: InferRequestType<
        (typeof rpc.api.novels)[":novelId"]["relationships"]["$post"]
      >["json"],
    ) => {
      const res = await rpc.api.novels[":novelId"].relationships.$post({
        param: { novelId },
        json: input,
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
  });
}

export function useStoryEvents(novelId: string) {
  return useQuery({
    queryKey: ["novels", novelId, "story-events"] as const,
    queryFn: async () => {
      const res = await rpc.api.novels[":novelId"]["story-events"].$get({
        param: { novelId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: Boolean(novelId),
  });
}

export function useCreateStoryEvent(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: InferRequestType<
        (typeof rpc.api.novels)[":novelId"]["story-events"]["$post"]
      >["json"],
    ) => {
      const res = await rpc.api.novels[":novelId"]["story-events"].$post({
        param: { novelId },
        json: input,
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
  });
}

export function useTimeline(
  novelId: string,
  query?: { chapter?: string; relationshipId?: string; asOf?: string },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: keys.timeline(novelId, query),
    queryFn: async () => {
      const res = await rpc.api.novels[":novelId"].timeline.$get({
        param: { novelId },
        query: query ?? {},
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: (options?.enabled ?? true) && Boolean(novelId),
  });
}

export function useSearch(novelId: string, query: string) {
  return useQuery({
    queryKey: keys.search(novelId, query),
    queryFn: async () => {
      const res = await rpc.api.novels[":novelId"].search.$get({
        param: { novelId },
        query: { q: query },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    // Below two characters the route answers with an empty list anyway.
    enabled: Boolean(novelId) && query.trim().length >= 2,
    // Search results are a snapshot of a moving manuscript; keeping them warm
    // across a session would show hits for prose that has since changed.
    staleTime: 0,
  });
}

export function useUsage(novelId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.usage(novelId),
    queryFn: async () => {
      const res = await rpc.api.novels[":novelId"].usage.$get({
        param: { novelId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: (options?.enabled ?? true) && Boolean(novelId),
  });
}

export function useAddChapter(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { afterNumber?: number; title?: string }) => {
      const res = await rpc.api.novels[":novelId"]["add-chapter"].$post({
        param: { novelId },
        json: input,
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
  });
}

export function useReorderChapters(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (order: number[]) => {
      const res = await rpc.api.novels[":novelId"]["reorder-chapters"].$post({
        param: { novelId },
        json: { order },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
  });
}

/** Applies the author-approved subset of a chapter analysis to the bible. */
export function useMergeAnalysis(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: InferRequestType<
        (typeof rpc.api.novels)[":novelId"]["merge"]["$post"]
      >["json"],
    ) => {
      const res = await rpc.api.novels[":novelId"].merge.$post({
        param: { novelId },
        json: input,
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    // A merge can touch every table in the novel at once.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
  });
}

/* --- Imperative reads, for the coordinated load in the writing studio. --- */

export async function fetchNovel(novelId: string) {
  const res = await rpc.api.novels[":novelId"].$get({ param: { novelId } });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

export async function fetchRelationships(novelId: string) {
  const res = await rpc.api.novels[":novelId"].relationships.$get({
    param: { novelId },
  });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

export async function fetchStoryEvents(novelId: string) {
  const res = await rpc.api.novels[":novelId"]["story-events"].$get({
    param: { novelId },
  });
  if (!res.ok) throw await apiError(res);
  return res.json();
}
