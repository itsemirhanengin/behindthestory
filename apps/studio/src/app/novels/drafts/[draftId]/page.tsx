import type { Metadata } from "next";
import { NewNovelWizard } from "@/components/onboarding/new-novel-wizard";

export const metadata: Metadata = {
  title: "New novel · BehindTheStory",
};

// `drafts` is a static segment, so it wins over `/novels/[novelId]` and stays
// outside that layout's novel chrome — the wizard owns the whole viewport.
export default async function NovelDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <NewNovelWizard draftId={draftId} />;
}
