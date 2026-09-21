"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The error boundary for the signed-in dashboard.
 *
 * There is one at the root already, in `app/error.tsx`. Next.js walks UP to
 * the nearest boundary, so without this file a thrown render anywhere in here
 * hits the root one and replaces the entire page: the sidebar and the header goes too, and the
 * visitor loses their place along with the thing that broke.
 *
 * This one sits inside the layout, so the shell stays and only the content
 * area is swapped. `reset()` re-renders just that part.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // `digest` is the only handle on the matching server log line.
    console.error("the signed-in dashboard failed to render", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-2 text-xl font-semibold text-gray-800 dark:text-white/90">
        This page did not load
      </h1>
      <p className="mb-6 max-w-md text-sm text-gray-500 dark:text-gray-400">
        Something went wrong drawing it. Your work is saved; nothing here was lost.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          Back to your dashboard
        </Link>
      </div>
    </div>
  );
}
