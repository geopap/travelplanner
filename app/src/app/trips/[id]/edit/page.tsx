import { TripEditLoader } from "@/components/trips/TripEditLoader";

export const metadata = { title: "Edit trip · TravelPlanner" };

export default async function EditTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="max-w-2xl mx-auto">
      <TripEditLoader tripId={id} />
    </div>
  );
}
