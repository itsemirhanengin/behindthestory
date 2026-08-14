import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferRequestType, InferResponseType } from 'hono/client';

import { apiError, rpc } from '@/lib/api';

/** A novel as it crosses the wire — timestamps are strings here, not Dates. */
export type Novel = InferResponseType<typeof rpc.api.novels.$get, 200>[number];

/**
 * The create payload, taken from the route rather than restated here. If the
 * wizard starts sending a field the server does not accept, that is a compile
 * error in the wizard instead of a 400 at runtime.
 */
export type CreateNovelInput = InferRequestType<typeof rpc.api.novels.$post>['json'];

const keys = {
  novels: ['novels'] as const,
};

export function useNovels() {
  return useQuery({
    queryKey: keys.novels,
    queryFn: async () => {
      const res = await rpc.api.novels.$get();
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useCreateNovel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateNovelInput) => {
      const res = await rpc.api.novels.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.novels }),
  });
}

export function useDeleteNovel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const res = await rpc.api.novels[':novelId'].$delete({ param: { novelId } });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.novels }),
  });
}
