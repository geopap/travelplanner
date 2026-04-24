import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Reset password · TravelPlanner" };

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="forgot" />
    </Suspense>
  );
}
