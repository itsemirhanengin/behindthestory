import { WritingStudio } from "@/components/write/writing-studio";

export default async function WritePage({
  params,
}: PageProps<"/novels/[novelId]/write/[chapterId]">) {
  const { novelId, chapterId } = await params;
  return <WritingStudio novelId={novelId} chapterId={chapterId} />;
}
