import { createContext, useContext, type ReactNode } from 'react';

/**
 * The novel id, read once from the route in the novel layout and handed down.
 *
 * Tab screens cannot use `useLocalSearchParams` for this: a sibling tab
 * mounted by tapping a NativeTabs trigger never receives the parent
 * `[novelId]` segment's params (verified live — the query sat disabled with
 * `novelId: undefined`). The layout always has them, so it is the one source.
 */
const NovelIdContext = createContext<string | null>(null);

export function NovelIdProvider({ novelId, children }: { novelId: string; children: ReactNode }) {
  return <NovelIdContext.Provider value={novelId}>{children}</NovelIdContext.Provider>;
}

export function useNovelId(): string {
  const novelId = useContext(NovelIdContext);
  if (!novelId) throw new Error('useNovelId must be used inside NovelIdProvider');
  return novelId;
}
