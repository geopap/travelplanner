import Link from "next/link";
import type { ReactNode } from "react";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="px-4 sm:px-8 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <Link
          href="/"
          className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          TravelPlanner
        </Link>
      </header>
      <div className="flex-1 px-4 sm:px-8 py-6 sm:py-10">
        <div className="mx-auto max-w-5xl grid gap-8 sm:grid-cols-[200px_1fr]">
          <aside>
            <nav aria-label="Settings">
              <ul className="grid gap-1 text-sm">
                <li>
                  <Link
                    href="/settings/profile"
                    className="block rounded-lg px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                  >
                    Profile
                  </Link>
                </li>
              </ul>
            </nav>
          </aside>
          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}
