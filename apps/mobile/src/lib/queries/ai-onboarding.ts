import { useMutation } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';

import { apiError, rpc } from '@/lib/api';

/**
 * Generation is a mutation, not a query: asking for a reading twice should
 * produce two fresh readings, so nothing here is cached. The wrapper buys
 * pending state, error handling, and request shapes tied to the server's.
 */
export function useAiOnboardingReading() {
  return useMutation({
    mutationFn: async (
      input: InferRequestType<typeof rpc.api.ai.onboarding.reading.$post>['json'],
    ) => {
      const res = await rpc.api.ai.onboarding.reading.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiOnboardingStyle() {
  return useMutation({
    mutationFn: async (
      input: InferRequestType<typeof rpc.api.ai.onboarding.style.$post>['json'],
    ) => {
      const res = await rpc.api.ai.onboarding.style.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}
