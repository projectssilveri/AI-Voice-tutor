"use client";

import Link from "next/link";

/**
 * Access is running out, or has.
 *
 * The whole point of showing an expiry is that somebody acts before it passes,
 * and a date in grey text at the bottom of a card is not that. This is the
 * banner that appears on the course itself while there is still time to do
 * something about it.
 *
 * Two states, and they need different words. RUNNING OUT is a nudge with the
 * course still fully usable — so it is amber and does not block anything. RUN
 * OUT is a wall, and the only useful thing on it is the way back in.
 *
 * Silent otherwise. A course bought outright never expires and a free one has
 * nothing to renew, so most students never see this at all — which is right.
 */

const DAY = 24 * 60 * 60 * 1000;
/** A fortnight. Long enough to act, short enough not to become wallpaper. */
const WARN_WITHIN_DAYS = 14;

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ExpiryNotice({
  courseId,
  courseTitle,
  expiresAt,
  accessVia,
}: {
  courseId: string;
  courseTitle: string;
  expiresAt: string | null;
  accessVia: string;
}) {
  if (!expiresAt) return null;

  const daysLeft = (new Date(expiresAt).getTime() - Date.now()) / DAY;
  if (daysLeft > WARN_WITHIN_DAYS) return null;

  const lapsed = daysLeft < 0;
  const isSubscription = accessVia === "subscription";

  // Where renewing actually goes. A subscription is renewed on the pricing
  // page; a single course is bought on its own page. Sending both to the same
  // place would land half of them somewhere they cannot do anything.
  const renewHref = isSubscription ? "/pricing" : `/courses/${courseId}`;
  const renewLabel = isSubscription ? "Renew your plan" : "Buy this course";

  if (lapsed) {
    return (
      <div
        role="status"
        className="mb-6 rounded-2xl border border-error-300 bg-error-50 p-5 dark:border-error-500/40 dark:bg-error-500/10"
      >
        <h2 className="mb-1 font-semibold text-error-800 dark:text-error-400">
          Your access to {courseTitle} has run out
        </h2>
        <p className="mb-4 text-sm text-error-700 dark:text-error-400">
          It ended on {when(expiresAt)}. Everything you have done is kept: your
          progress, quiz scores and any certificate. So picking this back up
          starts where you left off, not at the beginning.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={renewHref}
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            {renewLabel}
          </Link>
          <Link
            href="/profile#help-and-support"
            className="rounded-lg border border-error-300 px-5 py-2.5 text-sm font-medium text-error-700 transition hover:bg-white dark:border-error-500/40 dark:text-error-400 dark:hover:bg-white/5"
          >
            Ask about an extension
          </Link>
        </div>
      </div>
    );
  }

  const days = Math.max(0, Math.ceil(daysLeft));
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-warning-300 bg-warning-50 p-4 dark:border-warning-500/40 dark:bg-warning-500/10"
    >
      <p className="text-sm text-warning-900 dark:text-warning-300">
        <span className="font-semibold">
          {days === 0
            ? "Your access ends today."
            : days === 1
              ? "Your access ends tomorrow."
              : `Your access ends in ${days} days.`}
        </span>{" "}
        {courseTitle} runs until {when(expiresAt)}.
      </p>
      <Link
        href={renewHref}
        className="shrink-0 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600"
      >
        {renewLabel}
      </Link>
    </div>
  );
}
