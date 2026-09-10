"use client";

import { useState } from "react";

import { type StudentAssignment, submitAssignment } from "@/lib/assignments";
import { errorText } from "@/lib/api";

/**
 * One assignment plus this student's history with it.
 *
 * Resubmission is unlimited, so nothing here counts down and nothing is locked
 * after a wrong answer — the same rule quizzes follow. Only certification
 * exams are capped.
 */
export default function AssignmentCard({
  item,
  onSubmitted,
  showCourse = false,
}: {
  item: StudentAssignment;
  onSubmitted: () => Promise<void> | void;
  showCourse?: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const latest = item.submissions.at(-1) ?? null;

  async function handleSubmit() {
    if (!answer.trim()) {
      setError("Write an answer first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitAssignment(item.assignment.id, answer.trim());
      setAnswer("");
      await onSubmitted();
    } catch (caught) {
      setError(errorText(caught, "Could not submit."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">
            {item.assignment.title}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {showCourse ? `${item.course_title} · ` : ""}
            {item.module_title} · {item.assignment.max_score} marks
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            item.is_complete
              ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
              : item.submissions.length > 0
                ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-orange-400"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
          }`}
        >
          {item.is_complete
            ? "Complete"
            : item.submissions.length > 0
              ? "Try again"
              : "Not started"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        {item.assignment.prompt}
      </p>

      {latest ? (
        <div
          className={`mt-4 rounded-xl border p-4 ${
            latest.is_correct
              ? "border-success-500 bg-success-50 dark:bg-success-500/10"
              : "border-warning-500 bg-warning-50 dark:bg-warning-500/10"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-white/90">
              Attempt {latest.attempt_number} · {latest.score} /{" "}
              {item.assignment.max_score}
            </span>
            {/* An overridden mark says so: a student comparing their answer
                with the feedback needs to know a person changed it. */}
            {latest.graded_by === "admin" ? (
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-black/20 dark:text-gray-300">
                marked by an admin
              </span>
            ) : null}
          </div>
          {latest.feedback ? (
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {latest.feedback}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
          {item.submissions.length > 0 ? "Try again" : "Your answer"}
        </label>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={4}
          placeholder="Type your answer…"
          className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit answer"}
        </button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Unlimited submissions.
        </span>

        {item.submissions.length > 1 ? (
          <button
            type="button"
            onClick={() => setShowHistory((value) => !value)}
            className="ml-auto text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            {showHistory ? "Hide" : "Show"} all {item.submissions.length}{" "}
            attempts
          </button>
        ) : null}
      </div>

      {showHistory ? (
        <ul className="mt-4 space-y-2">
          {[...item.submissions].reverse().map((submission) => (
            <li
              key={submission.id}
              className="rounded-lg border border-gray-200 px-4 py-3 text-sm dark:border-gray-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-800 dark:text-white/90">
                  Attempt {submission.attempt_number} · {submission.score} /{" "}
                  {item.assignment.max_score}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(submission.submitted_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-gray-600 dark:text-gray-400">
                {submission.answer}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
