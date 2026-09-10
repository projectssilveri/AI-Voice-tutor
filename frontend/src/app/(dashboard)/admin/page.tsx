"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import { type UsageOverview, getUsage } from "@/lib/admin";
import { counted } from "@/lib/plural";

function AdminOverview() {
  const [usage, setUsage] = useState<UsageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await getUsage();
        if (!cancelled) setUsage(next);
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Could not load usage.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = [
    { label: "Users", value: usage?.total_users ?? 0 },
    { label: "Used the tutor", value: usage?.users_who_used_tutor ?? 0 },
    { label: "Voice sessions", value: usage?.total_sessions ?? 0 },
    { label: "Voice minutes", value: usage?.total_minutes ?? 0 },
    { label: "Interruptions", value: usage?.total_interruptions ?? 0 },
  ];

  const peak = Math.max(
    1,
    ...(usage?.sessions_per_day.map((point) => point.sessions) ?? [1]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          Admin
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Usage, activity, and certification attempts across the platform.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-2xl border border-gray-200 bg-white shadow-raised p-5 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {metric.label}
            </span>
            {/* The tile's value, not a heading — see the note in `Tiles.tsx`. */}
            <p className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
              {loading ? "…" : metric.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[
          {
            href: "/admin/courses",
            title: "Courses",
            body: "Write courses, modules, and the content the tutor teaches from.",
          },
          {
            href: "/admin/assignments",
            title: "Submissions",
            body: "Assignment answers, marked automatically. Override any the matcher got wrong.",
          },
          {
            href: "/admin/contact",
            title: "Messages",
            body: "What people sent through the contact form on the marketing site.",
          },
          {
            href: "/admin/users",
            title: "Users",
            body: "Every account, with enrolments and whether they have used the tutor.",
          },
          {
            href: "/admin/usage",
            title: "AI usage",
            body: "Sessions per day, minutes, and the most-used modules.",
          },
          {
            href: "/admin/attempt-grants",
            title: "Attempt grants",
            body: "Give a student extra certification attempts.",
          },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-2xl border border-gray-200 bg-white shadow-raised p-5 transition hover:border-brand-300 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-800"
          >
            <h2 className="mb-1 font-semibold text-gray-800 dark:text-white/90">
              {card.title}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {card.body}
            </p>
          </Link>
        ))}
      </div>

      {/* Sessions per day. A plain bar chart rather than ApexCharts: the data
          is a handful of integers, and this avoids shipping a chart library to
          render it. */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          Sessions per day
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : !usage || usage.sessions_per_day.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No voice sessions recorded yet.
          </p>
        ) : (
          <div className="flex h-48 items-end gap-2">
            {usage.sessions_per_day.map((point) => (
              <div
                key={point.day}
                className="flex flex-1 flex-col items-center gap-2"
                title={`${point.day}: ${counted(point.sessions, "session")}, ${point.minutes} min`}
              >
                <div
                  className="w-full rounded-t bg-brand-500"
                  style={{ height: `${(point.sessions / peak) * 100}%` }}
                />
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  {point.day.slice(5)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  // Rendering-level gate only. The API returns 403 to non-admins regardless.
  return (
    <RequireAuth roles={["admin"]}>
      <AdminOverview />
    </RequireAuth>
  );
}
