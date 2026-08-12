import { CharactersCanvas } from "@/components/characters/characters-canvas";

export default async function CharactersPage({
  params,
}: PageProps<"/novels/[novelId]/characters">) {
  const { novelId } = await params;
  return <CharactersCanvas novelId={novelId} />;
}
