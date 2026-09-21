"use client";

import { useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { type CourseRow, submitCourseForReview } from "@/lib/authoring";

/**
 * Where this course stands with the super admin, and the one button that
 * moves it.
 *
 * An ordinary admin writes courses and cannot publish them — that has always
 * been the owner's, and the ordinary update schema has no `is_published` field
 * to smuggle one through. What was missing was the other half: a way to say
 * "this is ready", and any sign of what happened next. An author's only signal
 * used to be the word "Unpublished", which covers being half-written, waiting
 * on somebody, and having been sent back — three situations with completely
 * different next steps.
 *
 * So this says which of them it is, in a sentence, and shows the owner's note
 * when there is one.
 */
export default function CourseReviewPanel({
  course,
  moduleCount,
  onChanged,
}: {
  course: CourseRow;
  /** From the editor, which already has the modules loaded. */
  moduleCount: number;
  onChanged: (updated: CourseRow) => void;
}) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = course.review_status;
  const canSubmit =
    (status === "draft" || status === "rejected") && moduleCount > 0;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      onChanged(await submitCourseForReview(course.id));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not submit it.",
      );
    } finally {
      setSaving(false);
    }
  }

  const state = {
    draft: {
      tone: "border-gray-200 dark:border-gray-800",
      heading: "Draft",
      body: isSuperAdmin
        ? "Not on sale. You can publish it yourself from the price panel below, or send it through review like anyone else."
        : "Only you can see this. When it is ready, send it to the super admin for approval.",
    },
    pending: {
      tone: "border-warning-500 bg-warning-50 dark:bg-warning-500/10",
      heading: "Waiting for approval",
      body: "Sent to the super admin. They will either put it on sale or send it back with a note.",
    },
    approved: {
      tone: "border-success-500 bg-success-50 dark:bg-success-500/10",
      heading: course.is_published ? "Approved and live" : "Approved",
      body: course.is_published
        ? "On the public catalogue now."
        : "Approved but not on sale. The super admin switches it on.",
    },
    rejected: {
      tone: "border-error-500 bg-error-50 dark:bg-error-500/10",
      heading: "Sent back",
      body: "The super admin asked for changes. Make them, then submit it again.",
    },
  }[status] ?? {
    tone: "border-gray-200 dark:border-gray-800",
    heading: "Draft",
    body: "Not on sale yet.",
  };

  return (
    <div className={`rounded-2xl border p-5 ${state.tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            {state.heading}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
            {state.body}
          </p>

          {/* The owner's words, shown to the person who has to act on them.
              Kept verbatim: a rejection paraphrased is a rejection argued
              with. */}
          {status === "rejected" && course.review_note ? (
            <p className="mt-3 rounded-lg border border-error-300 bg-white px-4 py-2.5 text-sm text-gray-700 dark:border-error-500/40 dark:bg-gray-900 dark:text-gray-300">
              <span className="font-medium">What they asked for: </span>
              {course.review_note}
            </p>
          ) : null}

          {status === "draft" && moduleCount === 0 ? (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              Add at least one module first. There is nothing to review or teach
              yet.
            </p>
          ) : null}
        </div>

        {canSubmit ? (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="shrink-0 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            {saving
              ? "Sending…"
              : status === "rejected"
                ? "Submit again"
                : "Submit for approval"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-error-500 bg-white px-4 py-2.5 text-sm text-error-700 dark:bg-gray-900 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
