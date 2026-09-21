"use client";

import { useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import {
  type ActivityLogRow,
  type UsageOverview,
  getUsage,
  listActivity,
} from "@/lib/admin";
import { counted } from "@/lib/plural";

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "open";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function UsageAndActivity() {
  const [usage, setUsage] = useState<UsageOverview | null>(null);
  const [activity, setActivity] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextUsage, nextActivity] = await Promise.all([
          getUsage(),
          listActivity(100),
        ]);
        if (cancelled) return;
        setUsage(nextUsage);
        setActivity(nextActivity);
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

  // The busiest module BY TIME, which is what the bars are scaled to now.
  const topPeak = Math.max(
    1,
    ...(usage?.top_modules.map((row) => row.seconds) ?? [1]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          AI usage
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Aggregated from voice sessions and transcripts.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="mb-1 text-base font-semibold text-gray-800 dark:text-white/90">
          Most-used modules
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Time spent with the tutor, longest first.
        </p>
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : !usage || usage.top_modules.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No module usage recorded yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {usage.top_modules.map((row) => (
              <li key={row.module_title}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">
                    {row.module_title}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {/* "0 min" on a lesson that actually happened reads as a
                        bug. Under a minute is said in words. */}
                    {row.seconds > 0 && row.minutes === 0
                      ? "under a minute"
                      : `${row.minutes} min`}{" "}
                    · {counted(row.sessions, "session")}
                  </span>
                </div>
                {/* A BAR, NOT A PROGRESS METER.
                    This was a `ProgressBar` filled to `sessions / topPeak`,
                    which is a ranking drawn in the one component that means
                    "progress towards completion". The busiest module showed a
                    full bar — reading as finished, or as a quota met, when it
                    only meant "more than the others". Nothing here is
                    progressing towards anything.

                    Same geometry, honest meaning: width is share of the
                    busiest module, and the number beside it is the real
                    count. */}
                {/* LENGTH IS TIME, not session count. Every module tends to
                    have exactly one session, so a bar scaled to sessions made
                    four modules look identical while one of them had eight
                    minutes of lecture and another had none. */}
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                  role="img"
                  aria-label={`${row.module_title}: ${row.minutes} minutes across ${row.sessions} sessions`}
                >
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{
                      width: `${topPeak > 0 ? Math.min((row.seconds / topPeak) * 100, 100) : 0}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Activity log
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Every voice session, newest first.
          </p>
        </div>
        <div className="max-w-full overflow-x-auto custom-scrollbar">
          <table className="table-wide min-w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.02]">
              <tr>
                {[
                  "Student",
                  "Module",
                  "Started",
                  "Duration",
                  "Turns",
                  "Interruptions",
                  // "Model" was here. Which Gemini build served a lesson tells
                  // an admin nothing they can act on, and it is an internal
                  // detail of how we buy the tutor. Issue 53. The API still
                  // returns it — `model_name` is on the row so a transcript
                  // keeps the context of what produced it — this screen just
                  // stops showing it.
                ].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              ) : activity.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-gray-500"
                  >
                    No voice sessions yet.
                  </td>
                </tr>
              ) : (
                activity.map((row) => (
                  <tr
                    key={row.session_id}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 dark:text-white/90">
                        {row.user_name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {row.user_email}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {row.module_title}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {new Date(row.started_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {formatDuration(row.duration_seconds)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {row.turns}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-800 dark:text-white/90">
                        {row.interruptions}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AdminUsagePage() {
  return (
    <RequireAuth roles={["admin"]}>
      <UsageAndActivity />
    </RequireAuth>
  );
}
