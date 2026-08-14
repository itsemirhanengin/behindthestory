"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiError } from "@/lib/query-client";
import { keys } from "@/lib/queries/keys";
import { rpc } from "@/lib/rpc";

export function useVariants(chapterId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.variants(chapterId),
    queryFn: async () => {
      const res = await rpc.api.chapters[":chapterId"].variants.$get({
        param: { chapterId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: (options?.enabled ?? true) && Boolean(chapterId),
  });
}

export function useCreateVariant(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (chapterId: string) => {
      const res = await rpc.api.chapters[":chapterId"].variants.$post({
        param: { chapterId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    // A new take changes the spine as well as the variant list.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
  });
}

export function useActivateVariant(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (chapterId: string) => {
      const res = await rpc.api.chapters[":chapterId"].activate.$post({
        param: { chapterId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }),
  });
}

export function useRevisions(chapterId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.revisions(chapterId),
    queryFn: async () => {
      const res = await rpc.api.chapters[":chapterId"].revisions.$get({
        param: { chapterId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: (options?.enabled ?? true) && Boolean(chapterId),
  });
}

export function useSaveRevision(chapterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { label?: string; content?: string }) => {
      const res = await rpc.api.chapters[":chapterId"].revisions.$post({
        param: { chapterId },
        json: input,
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.revisions(chapterId) }),
  });
}

export function useIndexStatus(chapterId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.chapterIndex(chapterId),
    queryFn: async () => {
      const res = await rpc.api.chapters[":chapterId"].index.$get({
        param: { chapterId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: (options?.enabled ?? true) && Boolean(chapterId),
  });
}

export function useIndexChapter(chapterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await rpc.api.chapters[":chapterId"].index.$post({
        param: { chapterId },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.chapterIndex(chapterId) }),
  });
}
