import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * The 404 page.
 *
 * Without this file Next.js serves its own built-in page: unstyled next to the
 * rest of the site, and — the part that actually matters — with no navigation
 * on it. A visitor who mistypes a URL or follows a stale link lands somewhere
 * with no route back and no reason to believe the site works.
 *
 * Deliberately no sidebar or header: this renders for URLs that matched no
 * route at all, so there is no telling whether the visitor is signed in, and
 * rendering a dashboard shell around a 404 would be a guess.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 dark:bg-gray-900">
      <div className="w-full max-w-lg text-center">
        <p className="mb-2 text-6xl font-bold text-brand-500 dark:text-brand-400">
          404
        </p>
        <h1 className="mb-3 text-2xl font-bold text-gray-800 dark:text-white/90">
          We can&apos;t find that page
        </h1>
        <p className="mb-8 text-base text-gray-500 dark:text-gray-400">
          The link may be out of date, or the address may have a typo in it.
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="rounded-lg bg-brand-500 px-6 py-3 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            Go to the home page
          </Link>
          <Link
            href="/courses"
            className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >
            Browse courses
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >
            My dashboard
          </Link>
        </div>

        <p className="mt-8 text-sm text-gray-500 dark:text-gray-400">
          Think something is broken?{" "}
          <Link
            href="/contact"
            className="font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600"
          >
            Tell us
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
