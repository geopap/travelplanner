import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile/ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const { user } = await getSessionUser();
  if (!user) {
    redirect("/sign-in");
  }

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Profile
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Update your display name and avatar. Other trip members see this
          information.
        </p>
      </header>
      <ProfileForm userId={user.id} />
    </div>
  );
}
