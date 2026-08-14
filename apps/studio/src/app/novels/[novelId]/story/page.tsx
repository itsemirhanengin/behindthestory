import { StoryMap } from "@/components/story/story-map";

export default async function StoryPage({
  params,
}: PageProps<"/novels/[novelId]/story">) {
  const { novelId } = await params;
  return <StoryMap novelId={novelId} />;
}
