import { ItineraryView } from "@/components/itinerary/ItineraryView";

export const metadata = { title: "Itinerary · TravelPlanner" };

export default async function ItineraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ItineraryView tripId={id} />;
}
