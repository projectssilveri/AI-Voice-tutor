"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import ProgressBar from "@/components/ui/ProgressBar";

/**
 * The pieces every dashboard is built from.
 *
 * Student, admin and super admin share these, so the three roles get one
 * product with different numbers in it rather than three different-looking
 * apps.
 */

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "brand";
  loading?: boolean;
}) {
  const toneClass = {
    default: "text-gray-800 dark:text-white/90",
    success: "text-success-600 dark:text-success-400",
    warning: "text-warning-600 dark:text-orange-400",
    brand: "text-brand-500 dark:text-brand-400",
  }[tone];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      {/* A `<p>`, not an `<h4>`. The number is the tile's VALUE, not a heading:
          as a heading it skipped a level under the page's h1 and put six bare
          figures — "8", "₹0" — into the screen-reader outline, where they say
          nothing without the label beside them. */}
      <p className={`mt-2 text-title-sm font-bold ${toneClass}`}>
        {loading ? "…" : value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white shadow-raised p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 ${className}`}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function DashboardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          {title}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
    >
      {message}
    </div>
  );
}

/**
 * A course card in the style learners expect from Udemy or Coursera: cover
 * strip, title, meta line, progress, and one obvious action.
 */
export function CourseCard({
  href,
  title,
  description,
  meta,
  percent,
  actionLabel = "Continue",
  badge,
  accent = 0,
  openInNewTab = false,
}: {
  href: string;
  title: string;
  description?: string | null;
  meta: string;
  percent?: number;
  actionLabel?: string;
  badge?: ReactNode;
  accent?: number;
  openInNewTab?: boolean;
}) {
  // Rotating cover gradients — courses carry no artwork of their own, and a
  // wall of identical grey cards is hard to scan.
  //
  // Every stop is deep enough to carry WHITE, which is what the course title
  // over it is. The first set ran 500 -> 400 and all six failed: measured
  // against white, the lightest stop of each was 2.98, 1.86, 1.67, 2.64, 1.81
  // and 2.65 against the 4.5 AA needs. `drop-shadow-sm` on the title made it
  // look survivable and counts for nothing in the measurement. One step deeper
  // on both ends clears it everywhere — the worst is now 5.02 — and the six
  // are still plainly six different colours.
  const gradients = [
    "from-brand-600 to-indigo-700",
    "from-emerald-700 to-teal-700",
    "from-orange-700 to-amber-700",
    "from-fuchsia-700 to-purple-700",
    "from-sky-700 to-cyan-700",
    "from-rose-700 to-pink-700",
  ];
  const gradient = gradients[accent % gradients.length];

  return (
    <Link
      href={href}
      target={openInNewTab ? "_blank" : undefined}
      rel={openInNewTab ? "noopener noreferrer" : undefined}
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:border-brand-300 hover:shadow-lg dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-800"
    >
      <div
        className={`relative flex h-24 items-end bg-gradient-to-br ${gradient} p-4`}
      >
        <span className="text-lg font-semibold text-white drop-shadow-sm">
          {title}
        </span>
        {badge ? <span className="absolute right-3 top-3">{badge}</span> : null}
      </div>

      <div className="flex flex-1 flex-col p-5">
        {description ? (
          <p className="mb-3 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
            {description}
          </p>
        ) : null}

        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{meta}</p>

        {percent !== undefined ? (
          <div className="mb-4 mt-auto">
            <div className="mb-1.5 flex justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Progress</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {Math.round(percent)}%
              </span>
            </div>
            <ProgressBar value={percent} />
          </div>
        ) : (
          <div className="mt-auto" />
        )}

        <span className="mt-2 text-sm font-medium text-brand-500 dark:text-brand-400 group-hover:text-brand-600">
          {actionLabel} →
        </span>
      </div>
    </Link>
  );
}
