import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          TravelPlanner
        </h1>
        <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
          Plan your next trip end-to-end: days, activities, hotels, flights,
          bookmarks and budget — all in one place.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center h-11 px-6 rounded-full bg-zinc-900 text-white font-medium hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center h-11 px-6 rounded-full border border-zinc-300 dark:border-zinc-700 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            Create an account
          </Link>
        </div>
      </div>
    </main>
  );
}
