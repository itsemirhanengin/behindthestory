import { ReadingView } from "@/components/read/reading-view";

export default async function ReadPage({
  params,
}: PageProps<"/novels/[novelId]/read">) {
  const { novelId } = await params;
  return <ReadingView novelId={novelId} />;
}
