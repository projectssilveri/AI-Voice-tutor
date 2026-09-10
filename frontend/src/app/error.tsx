"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The error boundary for everything under the root layout.
 *
 * Without this file, an exception thrown while rendering any page takes the
 * whole tree down: React unmounts it and the visitor is left on a blank white
 * screen with nothing to click and no indication anything went wrong. In
 * development Next.js shows an overlay, which is exactly why the gap survives
 * to production unnoticed.
 *
 * `reset()` re-renders the segment. Worth offering because a good share of
 * these are transient — a failed fetch during render, a hydration hiccup — and
 * retrying is cheaper for the visitor than losing their place.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the matching server-side log entry, so
    // it goes to the console even though the message itself does not reach the
    // visitor.
    console.error("Unhandled render error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 dark:bg-gray-900">
      <div className="w-full max-w-lg text-center">
        <h1 className="mb-3 text-2xl font-bold text-gray-800 dark:text-white/90">
          Something went wrong
        </h1>
        <p className="mb-8 text-base text-gray-500 dark:text-gray-400">
          This page failed to load. It is usually temporary. Trying again is
          worth a go.
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-brand-500 px-6 py-3 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >
            Go to the home page
          </Link>
        </div>

        {/* Shown, not hidden: it is the one thing that lets support tie a
            report to a log line. The message itself is not shown — it can
            carry internals a visitor should not read. */}
        {error.digest ? (
          <p className="mt-8 font-mono text-xs text-gray-500 dark:text-gray-400">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
