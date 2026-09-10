"use client";

import Link from "next/link";

import { ApiError } from "@/lib/api";

/**
 * What to show when the backend answers 402 Payment Required.
 *
 * The coursework routes — quiz, assignments, certification exam — are behind
 * the paywall, so reaching one by URL on a course you have not bought now
 * fails with 402. Rendering that as a bare red error string leaves a dead end:
 * the message says to buy the course but gives nothing to click, and the Buy
 * button lives one page away.
 *
 * Returns null for any other error so callers can fall through to their normal
 * error banner.
 */
export default function PaywallNotice({
  error,
  courseId,
}: {
  error: unknown;
  /**
   * Omitted when the refusal itself is what stopped us learning which course
   * this belongs to — the certification exam cover answers 402 before it can
   * tell the caller its `course_id`. The link falls back to the course list,
   * which is still somewhere to go rather than a dead end.
   */
  courseId?: string;
}) {
  const isPaywalled = error instanceof ApiError && error.status === 402;
  if (!isPaywalled) return null;

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-25 p-6 dark:border-brand-800 dark:bg-brand-500/10">
      <h2 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
        This is part of a paid course
      </h2>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Quizzes, assignments and the certification exam come with the course.
        You can keep reading the material either way.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={courseId ? `/learn/${courseId}` : "/learn"}
          className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
        >
          {courseId ? "See the course" : "Browse courses"}
        </Link>
        <Link
          href="/pricing"
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
        >
          Subscription plans
        </Link>
      </div>
    </div>
  );
}
