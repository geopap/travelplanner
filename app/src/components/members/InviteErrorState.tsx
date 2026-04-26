import Link from "next/link";

export type InviteErrorVariant = "expired" | "used" | "revoked" | "invalid";

interface InviteErrorStateProps {
  variant: InviteErrorVariant;
}

const COPY: Record<
  InviteErrorVariant,
  { title: string; message: string; iconPath: string }
> = {
  expired: {
    title: "This invitation has expired",
    message:
      "Invitations are valid for 48 hours. Ask the trip owner to send you a new one.",
    iconPath: "M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  used: {
    title: "This invitation has already been used",
    message:
      "If you accepted it from another device, you should already have access to the trip.",
    iconPath: "M5 13l4 4L19 7",
  },
  revoked: {
    title: "This invitation was revoked",
    message:
      "The trip owner cancelled this invitation. Ask them to send you a new one if you still need access.",
    iconPath: "M6 18L18 6M6 6l12 12",
  },
  invalid: {
    title: "This invitation link is not valid",
    message:
      "The link may be incomplete or mistyped. Ask the trip owner to send you a fresh invitation.",
    iconPath: "M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12.25a2 2 0 00-3.48 0L3.19 16a2 2 0 001.74 3z",
  },
};

export function InviteErrorState({ variant }: InviteErrorStateProps) {
  const { title, message, iconPath } = COPY[variant];
  return (
    <div className="w-full max-w-md mx-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center shadow-sm">
      <div
        className="mx-auto w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-6 h-6"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </div>
      <h1 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center h-10 px-5 rounded-full bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
      >
        Back to home
      </Link>
    </div>
  );
}
