import { TripForm } from "@/components/trips/TripForm";

export const metadata = { title: "New trip · TravelPlanner" };

export default function NewTripPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <TripForm mode="create" />
    </div>
  );
}
