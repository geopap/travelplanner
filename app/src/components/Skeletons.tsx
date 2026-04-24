// Skeleton loader primitives. Use in Suspense boundaries and pending states.

export function SkeletonLine({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <SkeletonLine className="h-5 w-3/4 mb-3" />
      <SkeletonLine className="h-3 w-1/2 mb-2" />
      <SkeletonLine className="h-3 w-2/3" />
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonDay() {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <SkeletonLine className="h-4 w-32" />
        <SkeletonLine className="h-4 w-16" />
      </div>
      <SkeletonLine className="h-3 w-full mb-2" />
      <SkeletonLine className="h-3 w-5/6 mb-2" />
      <SkeletonLine className="h-3 w-2/3" />
    </div>
  );
}
