import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata = { title: "Set new password · TravelPlanner" };

// Supabase's default recovery email lands at NEXT_PUBLIC_SITE_URL/reset-password
// with an access_token in the URL hash. The form reads it client-side.
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
