import { useQuery } from '@tanstack/react-query';

import { apiError, rpc } from '@/lib/api';

/**
 * The generic entity routes serve many tables through one path, so the
 * server's response type is a union of all of them. The entity name is what
 * decides which member you get, and the caller always knows it — so these
 * hooks take the row type as a parameter and narrow the union at the
 * boundary, exactly as the studio does.
 */
export type NovelEntity =
  | 'characters'
  | 'locations'
  | 'location-links'
  | 'chapters'
  | 'story-elements'
  | 'character-facts';

export function entityKey(novelId: string, entity: NovelEntity) {
  return ['novels', novelId, entity] as const;
}

export function useEntityList<T>(novelId: string, entity: NovelEntity) {
  return useQuery({
    queryKey: entityKey(novelId, entity),
    queryFn: async () => {
      const res = await rpc.api.novels[':novelId'][':entity'].$get({
        param: { novelId, entity },
      });
      if (!res.ok) throw await apiError(res);
      return (await res.json()) as T[];
    },
    enabled: Boolean(novelId),
  });
}

export function useEntity<T>(entity: NovelEntity, id: string) {
  return useQuery({
    queryKey: ['entities', entity, id] as const,
    queryFn: async () => {
      const res = await rpc.api.entities[':entity'][':id'].$get({
        param: { entity, id },
      });
      if (!res.ok) throw await apiError(res);
      return (await res.json()) as T;
    },
    enabled: Boolean(id),
  });
}
