import { redirect } from "next/navigation";

export const metadata = { title: "Sign up · TravelPlanner" };
export const dynamic = "force-dynamic";

// B-019: Public sign-up has been removed. Account creation is invitation-only;
// users must follow an /invite/[token] link. Anyone hitting /sign-up directly
// is redirected to /sign-in with a notice banner explaining the new flow.
export default function SignUpPage(): never {
  redirect("/sign-in?notice=invite_only");
}
