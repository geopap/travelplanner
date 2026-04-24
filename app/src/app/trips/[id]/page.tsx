import { TripOverview } from "@/components/trips/TripOverview";

export const metadata = { title: "Trip · TravelPlanner" };

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TripOverview tripId={id} />;
}
