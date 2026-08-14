import { useMutation } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';

import { apiError, rpc } from '@/lib/api';

/** Proposes a style contract from the novel's premise — the Story Bible's
 *  "Suggest from premise" button. A mutation because two runs should differ. */
export function useAiStyle() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.style.$post>['json']) => {
      const res = await rpc.api.ai.style.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}
