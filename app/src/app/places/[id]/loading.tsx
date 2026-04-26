// Skeleton placeholder for `/places/[id]`. Mirrors the layout of
// `PlaceDetailView` so the visual shift on hydration is minimal.

export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading place details"
      className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10"
    >
      <div className="space-y-3">
        <div className="h-5 w-20 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-8 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mt-6 h-16 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="h-16 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-16 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mt-6 space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="aspect-square animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="aspect-square animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="aspect-square animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </main>
  );
}
