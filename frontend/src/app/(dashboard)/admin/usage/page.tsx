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
import ProgressBar from "@/components/ui/ProgressBar";

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

  const topPeak = Math.max(
    1,
    ...(usage?.top_modules.map((row) => row.sessions) ?? [1]),
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
        <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          Most-used modules
        </h2>
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
                    {counted(row.sessions, "session")} · {row.minutes} min
                  </span>
                </div>
                <ProgressBar
                  value={(row.sessions / topPeak) * 100}
                  label={`${row.sessions} sessions`}
                />
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
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.02]">
              <tr>
                {[
                  "Student",
                  "Module",
                  "Started",
                  "Duration",
                  "Turns",
                  "Interruptions",
                  "Model",
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
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {row.model_name}
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
