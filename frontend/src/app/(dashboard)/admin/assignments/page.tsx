"use client";

import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import {
  type AdminSubmissionRow,
  listAllSubmissions,
  overrideSubmission,
} from "@/lib/assignments";
import { counted } from "@/lib/plural";

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * The submission review queue.
 *
 * Matching cannot recognise an answer that is right in a way the author did
 * not anticipate, so an admin has to be able to re-mark one. Every override is
 * attributed to the admin who made it.
 */
function SubmissionReview() {
  const [rows, setRows] = useState<AdminSubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [onlyWrong, setOnlyWrong] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listAllSubmissions());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load submissions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEditing(row: AdminSubmissionRow) {
    setEditing(row.id);
    setScore(row.score);
    setFeedback(row.feedback ?? "");
    setNotice(null);
  }

  async function handleOverride(row: AdminSubmissionRow) {
    setSaving(true);
    setError(null);
    try {
      await overrideSubmission(row.id, score, feedback.trim() || null);
      setNotice(`Re-marked ${row.user_name}'s answer as ${score}.`);
      setEditing(null);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the mark.",
      );
    } finally {
      setSaving(false);
    }
  }

  const visible = onlyWrong ? rows.filter((row) => !row.is_correct) : rows;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
            Assignment submissions
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Marked automatically by matching the answer. Override any the
            matcher got wrong.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-400">
          <input
            type="checkbox"
            checked={onlyWrong}
            onChange={(e) => setOnlyWrong(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-500 dark:text-brand-400 focus:ring-brand-500/20 dark:border-gray-700"
          />
          Only show wrong answers
        </label>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-2xl border border-success-500 bg-success-50 p-4 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            {loading ? "Loading…" : counted(visible.length, "submission")}
          </h2>
        </div>

        {loading ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500">
            Loading…
          </p>
        ) : visible.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {rows.length === 0
              ? "No submissions yet."
              : "Nothing matches this filter."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {visible.map((row) => (
              <li key={row.id} className="px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 dark:text-white/90">
                      {row.assignment_title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {row.course_title} · {row.module_title} · attempt{" "}
                      {row.attempt_number}
                    </p>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {row.user_name}{" "}
                      <span className="text-gray-500 dark:text-gray-400">
                        ({row.user_email})
                      </span>
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        row.is_correct
                          ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                          : "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
                      }`}
                    >
                      {row.score} / {row.max_score}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {row.graded_by === "admin"
                        ? `by ${row.graded_by_name ?? "admin"}`
                        : "auto-marked"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        editing === row.id
                          ? setEditing(null)
                          : startEditing(row)
                      }
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                    >
                      {editing === row.id ? "Close" : "Override"}
                    </button>
                  </div>
                </div>

                <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm whitespace-pre-wrap text-gray-700 dark:bg-white/[0.03] dark:text-gray-300">
                  {row.answer}
                </div>

                {row.feedback ? (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    {row.feedback}
                  </p>
                ) : null}

                {editing === row.id ? (
                  <div className="mt-4 grid gap-3 rounded-lg border border-gray-200 p-4 md:grid-cols-[120px_1fr_auto] dark:border-gray-800">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-400">
                        Score (max {row.max_score})
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={row.max_score}
                        value={score}
                        onChange={(e) => setScore(Number(e.target.value))}
                        className={FIELD}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-400">
                        Feedback
                      </label>
                      <input
                        type="text"
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="Why the mark changed"
                        className={FIELD}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => handleOverride(row)}
                        disabled={saving}
                        className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save mark"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AdminAssignmentsPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <SubmissionReview />
    </RequireAuth>
  );
}
