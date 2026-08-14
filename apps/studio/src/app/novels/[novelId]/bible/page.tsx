import { StoryBible } from "@/components/bible/story-bible";

export default async function BiblePage({
  params,
}: PageProps<"/novels/[novelId]/bible">) {
  const { novelId } = await params;
  return <StoryBible novelId={novelId} />;
}
