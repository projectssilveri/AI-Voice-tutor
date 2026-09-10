"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type AccessExtension,
  grantExtension,
  listExtensions,
} from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { counted } from "@/lib/plural";

/**
 * Give somebody longer on a course.
 *
 * A GRANT, not an edit to their expiry. Every one is recorded with who gave it
 * and why — the same shape as `attempt_grants` (decision 24), because "who gave
 * this student another three months" is asked afterwards and an overwritten
 * date cannot answer it.
 *
 * The history below the form is the point of doing it this way. Without it this
 * would just be a date field, and a date field is exactly what makes the
 * question unanswerable.
 */

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/** Quick offsets, because "three months from now" is what people actually mean. */
const PRESETS = [
  { label: "+1 month", days: 30 },
  { label: "+3 months", days: 90 },
  { label: "+6 months", days: 182 },
  { label: "+1 year", days: 365 },
];

function isoDay(offsetDays: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ExtendAccess({
  userId,
  courses,
  onGranted,
}: {
  userId: string;
  /** The courses this person actually holds, so the picker offers real ones. */
  courses: { id: string; title: string }[];
  onGranted?: () => void;
}) {
  const [history, setHistory] = useState<AccessExtension[]>([]);
  const [open, setOpen] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [until, setUntil] = useState(() => isoDay(90));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHistory(await listExtensions(userId));
    } catch {
      // The history is context, not the control. Losing it must not stop
      // somebody granting an extension.
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!courseId) {
      setError("Pick a course first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const granted = await grantExtension(userId, {
        course_id: courseId,
        // Midday rather than midnight: a date picker gives a bare day, and
        // 00:00 on the chosen day would end access at the START of it — a day
        // earlier than the admin meant.
        extends_to: `${until}T12:00:00Z`,
        reason: reason.trim() || undefined,
      });
      setNotice(
        `${granted.course_title ?? "Access"} now runs to ${when(granted.extends_to)}.`,
      );
      setReason("");
      await load();
      onGranted?.();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not grant the extension.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-white/90">
            Extend access
          </h3>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Give them longer on a course.{" "}
            {history.length > 0
              ? `${counted(history.length, "extension")} granted so far.`
              : "None granted yet."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          {open ? "Cancel" : "Grant an extension"}
        </button>
      </div>

      {notice ? (
        <p className="mt-4 rounded-lg border border-success-500 bg-success-50 px-4 py-2.5 text-sm text-success-800 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </p>
      ) : null}

      {open ? (
        <div className="mt-5 space-y-4 border-t border-gray-100 pt-5 dark:border-gray-800">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
            >
              {error}
            </p>
          ) : null}

          <div>
            <label
              htmlFor="extend-course"
              className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
            >
              Course
            </label>
            <select
              id="extend-course"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className={FIELD}
            >
              <option value="">Choose a course…</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="extend-until"
              className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
            >
              Runs until
            </label>
            <input
              id="extend-until"
              type="date"
              value={until}
              min={isoDay(1)}
              onChange={(event) => setUntil(event.target.value)}
              className={`${FIELD} max-w-xs`}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setUntil(isoDay(preset.days))}
                  className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {/* Said plainly, because it is the one rule that stops a mistyped
                date doing damage. */}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              An extension only ever pushes the date later. Granting a shorter
              one cannot take away access they already have.
            </p>
          </div>

          <div>
            <label
              htmlFor="extend-reason"
              className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
            >
              Reason{" "}
              <span className="font-normal text-gray-500 dark:text-gray-400">
                (recorded)
              </span>
            </label>
            <input
              id="extend-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder="Why are you extending this?"
              className={FIELD}
            />
          </div>

          <button
            type="button"
            disabled={busy || !courseId}
            onClick={() => void submit()}
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? "Granting…" : "Grant extension"}
          </button>
        </div>
      ) : null}

      {history.length > 0 ? (
        <ul className="mt-5 space-y-2 border-t border-gray-100 pt-4 dark:border-gray-800">
          {history.map((row) => (
            <li
              key={row.id}
              className="text-sm text-gray-600 dark:text-gray-400"
            >
              <span className="font-medium text-gray-800 dark:text-white/90">
                {row.course_title ?? row.plan_name ?? "Access"}
              </span>{" "}
              until {when(row.extends_to)}
              {row.granted_by_name ? ` · by ${row.granted_by_name}` : ""}
              {row.reason ? ` · ${row.reason}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
