import { useQuery } from '@tanstack/react-query';

import { apiError, rpc } from '@/lib/api';

/** Tokens spent on this novel, by endpoint — the Story Bible's ledger. */
export function useUsage(novelId: string) {
  return useQuery({
    queryKey: ['novels', novelId, 'usage'] as const,
    queryFn: async () => {
      const res = await rpc.api.novels[':novelId'].usage.$get({ param: { novelId } });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: Boolean(novelId),
  });
}
