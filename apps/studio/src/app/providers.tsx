"use client";

import { QueryClientProvider } from "@tanstack/react-query";

import { getQueryClient } from "@/lib/query-client";

/**
 * Deliberately not `useState(() => new QueryClient())`: there is no suspense
 * boundary above this, so React would discard the client if the first render
 * suspended. `getQueryClient` keeps one instance per browser and a fresh one
 * per server request.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
