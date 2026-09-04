/**
 * Every cache key in one place.
 *
 * Keys are built as hierarchies — `["novels", id, "chapters"]` — so that
 * invalidating `["novels", id]` reaches everything hanging off that novel
 * without listing each child. That prefix rule is the whole reason this file
 * exists rather than keys being written inline at each call site, where they
 * drift and quietly stop matching.
 */
export const keys = {
  session: ["session"] as const,

  workspaces: ["workspaces"] as const,
  billingCatalogue: ["billing", "catalogue"] as const,
  billing: (workspaceId: string) => ["billing", workspaceId] as const,

  novels: ["novels"] as const,
  novel: (novelId: string) => ["novels", novelId] as const,
  novelDrafts: ["novel-drafts"] as const,
  novelDraft: (draftId: string) => ["novel-drafts", draftId] as const,

  chapters: (novelId: string) => ["novels", novelId, "chapters"] as const,
  characters: (novelId: string) => ["novels", novelId, "characters"] as const,
  locations: (novelId: string) => ["novels", novelId, "locations"] as const,
  elements: (novelId: string) => ["novels", novelId, "story-elements"] as const,
  relationships: (novelId: string) =>
    ["novels", novelId, "relationships"] as const,
  timeline: (novelId: string, params?: Record<string, string | undefined>) =>
    ["novels", novelId, "timeline", params ?? {}] as const,
  usage: (novelId: string) => ["novels", novelId, "usage"] as const,
  search: (novelId: string, query: string) =>
    ["novels", novelId, "search", query] as const,

  revisions: (chapterId: string) => ["chapters", chapterId, "revisions"] as const,
  variants: (chapterId: string) => ["chapters", chapterId, "variants"] as const,
  chapterIndex: (chapterId: string) => ["chapters", chapterId, "index"] as const,
} as const;
