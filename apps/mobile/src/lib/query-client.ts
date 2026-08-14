import { QueryClient } from '@tanstack/react-query';

/**
 * One client for the whole app. Nothing exotic: a phone on a train loses the
 * network often enough that a single automatic retry is politeness, and a
 * minute of staleness is invisible next to the cost of refetching a list the
 * writer just looked at.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
    },
  },
});
