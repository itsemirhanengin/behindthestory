import type { Metadata } from "next";
import { NewNovelWizard } from "@/components/onboarding/new-novel-wizard";

export const metadata: Metadata = {
  title: "New novel · StoryForge",
};

// A static segment, so it wins over `/novels/[novelId]` and stays outside that
// layout's novel chrome — the wizard owns the whole viewport.
export default function NewNovelPage() {
  return <NewNovelWizard />;
}
