import { LocationsCanvas } from "@/components/locations/locations-canvas";

export default async function LocationsPage({
  params,
}: PageProps<"/novels/[novelId]/locations">) {
  const { novelId } = await params;
  return <LocationsCanvas novelId={novelId} />;
}
