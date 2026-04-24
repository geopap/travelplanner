import Link from "next/link";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  message: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
}

export function EmptyState({
  icon,
  title,
  message,
  ctaLabel,
  ctaHref,
  onCtaClick,
}: EmptyStateProps) {
  const cta = ctaLabel
    ? ctaHref
      ? (
        <Link
          href={ctaHref}
          className="mt-6 inline-flex items-center justify-center h-10 px-5 rounded-full bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
        >
          {ctaLabel}
        </Link>
      )
      : (
        <button
          type="button"
          onClick={onCtaClick}
          className="mt-6 inline-flex items-center justify-center h-10 px-5 rounded-full bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
        >
          {ctaLabel}
        </button>
      )
    : null;

  return (
    <div className="text-center py-12 px-6 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      <div
        className="mx-auto mb-4 w-12 h-12 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto">
        {message}
      </p>
      {cta}
    </div>
  );
}
