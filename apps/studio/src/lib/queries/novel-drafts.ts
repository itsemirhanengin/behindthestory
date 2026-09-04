"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";

import { apiError } from "@/lib/query-client";
import { keys } from "@/lib/queries/keys";
import { rpc } from "@/lib/rpc";

/**
 * The wizard's autosave payload and the row that comes back, both taken from
 * the route. The jsonb columns arrive as the validated shapes the server
 * accepted, so the wizard narrows them back to its own types with a cast
 * rather than a re-parse.
 */
export type NovelDraftInput = InferRequestType<
  (typeof rpc.api)["novel-drafts"][":draftId"]["$put"]
>["json"];

export type NovelDraft = InferResponseType<
  (typeof rpc.api)["novel-drafts"][":draftId"]["$put"]
>;

export function useNovelDrafts() {
  return useQuery({
    queryKey: keys.novelDrafts,
    queryFn: async () => {
      const res = await rpc.api["novel-drafts"].$get();
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useNovelDraft(draftId: string) {
  return useQuery({
    queryKey: keys.novelDraft(draftId),
    queryFn: async () => {
      const res = await rpc.api["novel-drafts"][":draftId"].$get({
        param: { draftId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: Boolean(draftId),
    // A missing draft is a fact (deleted on another device), not a blip —
    // retrying only delays the "this draft is gone" answer.
    retry: false,
  });
}

/** "New novel": mints an empty draft row and hands back its id to route to. */
export function useCreateNovelDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await rpc.api["novel-drafts"].$post();
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: (draft) => {
      queryClient.setQueryData(keys.novelDraft(draft.id), draft);
      queryClient.invalidateQueries({ queryKey: keys.novelDrafts, exact: true });
    },
  });
}

export function useSaveNovelDraft(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NovelDraftInput) => {
      const res = await rpc.api["novel-drafts"][":draftId"].$put({
        param: { draftId },
        json: input,
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: (draft) => {
      queryClient.setQueryData(keys.novelDraft(draftId), draft);
      // The shelf card shows title, excerpt and freshness — keep it honest.
      queryClient.invalidateQueries({ queryKey: keys.novelDrafts, exact: true });
    },
  });
}

export function useDeleteNovelDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string) => {
      const res = await rpc.api["novel-drafts"][":draftId"].$delete({
        param: { draftId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: (_result, draftId) => {
      queryClient.removeQueries({ queryKey: keys.novelDraft(draftId) });
      queryClient.invalidateQueries({ queryKey: keys.novelDrafts, exact: true });
    },
  });
}
