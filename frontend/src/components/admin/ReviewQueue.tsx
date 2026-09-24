"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatMoney } from "@/lib/money";
import {
  type ReviewRow,
  approveCourse,
  listCourseReviews,
  rejectCourse,
} from "@/lib/courseReviews";
import { counted } from "@/lib/plural";

/**
 * Courses admins have sent up for approval.
 *
 * IT USED TO LIVE ON THE WEBSITE SCREEN, on the reasoning that approving is the
 * same decision as publishing and publishing already sat there. The reasoning
 * was sound and the result was not: the panel renders nothing when the queue is
 * empty, so with nothing pending there was no trace of the feature anywhere in
 * the product. A tester went looking for the approvals screen, found none, and
 * filed issues 34 and 35 saying the workflow was missing. It was not missing.
 * It was invisible.
 *
 * So it has a page and a menu entry now, and on that page it says so when there
 * is nothing waiting. `standalone` is what distinguishes the two: embedded it
 * still disappears when empty, because a permanent "nothing is waiting" panel
 * above the catalogue is a panel people learn to scroll past.
 *
 * REJECTING REQUIRES A NOTE, and the box is right there rather than behind a
 * confirm dialog. The server refuses an empty one — "rejected" with no reason
 * leaves the author guessing and their next submission is a guess too — so
 * making the reason the natural next thing to type is the difference between a
 * workflow and an argument.
 *
 * Renders nothing when the queue is empty. A permanently visible "nothing is
 * waiting" panel is a panel the owner learns to scroll past.
 */
export default function ReviewQueue({
  onDecided,
  standalone = false,
}: {
  /** Told after an approval, so the catalogue beside this reloads. */
  onDecided: () => void;
  /** On its own page: show an empty state instead of vanishing. */
  standalone?: boolean;
}) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await listCourseReviews("pending"));
      setError(null);
    } catch (caught) {
      // Embedded above the catalogue, stay quiet: an error banner there would
      // suggest the whole screen had failed when it has not. On its own page
      // silence is worse — an empty screen that is actually a broken request
      // reads as "nothing to approve", which is the wrong thing to believe.
      if (standalone) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load the approval queue.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [standalone]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(row: ReviewRow) {
    setBusyId(row.id);
    setError(null);
    try {
      await approveCourse(row.id, { publish: true });
      await load();
      onDecided();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not approve it.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function sendBack(row: ReviewRow) {
    setBusyId(row.id);
    setError(null);
    try {
      await rejectCourse(row.id, note);
      setRejecting(null);
      setNote("");
      await load();
      onDecided();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not send it back.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    if (!standalone) return null;
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        {error ? (
          <p role="alert" className="text-sm text-error-700 dark:text-error-400">
            {error}
          </p>
        ) : (
          <>
            <p className="text-base font-medium text-gray-800 dark:text-white/90">
              {loading ? "Checking…" : "Nothing waiting for approval"}
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              A course sent for approval appears here for you to approve or
              send back.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mb-8 rounded-2xl border border-warning-500 bg-warning-50 p-6 dark:bg-warning-500/10">
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
        {counted(rows.length, "course")} waiting for you
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        An admin has finished writing these and asked for them to go on sale.
        Approving publishes the course.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-error-500 bg-white px-4 py-2.5 text-sm text-error-700 dark:bg-gray-900 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <Link
                  href={`/admin/courses/${row.id}`}
                  className="text-sm font-medium text-gray-800 hover:text-brand-600 dark:text-white/90 dark:hover:text-brand-400"
                >
                  {row.title}
                </Link>
                <p className="mt-0.5 line-clamp-2 max-w-xl text-xs text-gray-500 dark:text-gray-400">
                  {row.description || "No description."}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {counted(row.module_count, "module")} ·{" "}
                  {row.price_minor > 0
                    ? formatMoney(row.price_minor, row.currency)
                    : "Free"}
                  {row.submitted_by_name
                    ? ` · from ${row.submitted_by_name}`
                    : ""}
                  {row.submitted_at
                    ? ` · ${new Date(row.submitted_at).toLocaleDateString(
                        "en-IN",
                        {
                          day: "numeric",
                          month: "short",
                        },
                      )}`
                    : ""}
                </p>
              </div>

              {/* `shrink-0` ONLY FROM sm UP. On a phone it stopped this button group
                  narrowing at all, so three buttons held the row at their own
                  width and pushed the whole page 121px wider than the screen —
                  `flex-wrap` could not help, because nothing was allowed to
                  shrink enough to wrap. Full width below sm, so the buttons
                  wrap onto their own line instead. */}
              <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                {/* Read it before deciding. The link is first because opening
                    the course is what an owner should do, and approving from a
                    one-line summary is how a half-written course goes live. */}
                <Link
                  href={`/admin/courses/${row.id}`}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                >
                  Open it
                </Link>
                <button
                  type="button"
                  onClick={() => void approve(row)}
                  disabled={busyId === row.id}
                  className="rounded-lg bg-success-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-success-700 disabled:opacity-40"
                >
                  {busyId === row.id ? "Working…" : "Approve and publish"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRejecting((current) =>
                      current === row.id ? null : row.id,
                    )
                  }
                  className="rounded-lg border border-error-500 px-4 py-2 text-sm font-medium text-error-600 transition hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-500/10"
                >
                  Send back
                </button>
              </div>
            </div>

            {rejecting === row.id ? (
              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
                <label className="min-w-[240px] flex-1">
                  <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    What needs changing? The author sees this.
                  </span>
                  <input
                    type="text"
                    value={note}
                    maxLength={2000}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Module 3 has no content, and the price looks wrong."
                    className="h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void sendBack(row)}
                  disabled={busyId === row.id || !note.trim()}
                  className="h-10 rounded-lg bg-error-700 px-4 text-sm font-medium text-white transition hover:bg-error-800 disabled:opacity-40"
                >
                  Send it back
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
