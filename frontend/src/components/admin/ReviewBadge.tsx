import { type CourseRow } from "@/lib/authoring";

/**
 * Where a course stands with the super admin.
 *
 * One badge rather than the old "Unpublished" flag, because unpublished was
 * four different situations wearing one word: still being written, waiting on
 * the owner, sent back with a note, or approved and simply not switched on
 * yet. An author looking at "Unpublished" could not tell whether the ball was
 * in their court.
 */
export default function ReviewBadge({ course }: { course: CourseRow }) {
  if (course.is_published) {
    return (
      <span className="rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-400">
        Live
      </span>
    );
  }

  const look = {
    pending: {
      label: "Waiting for approval",
      cls: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-orange-400",
    },
    rejected: {
      label: "Sent back",
      cls: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400",
    },
    approved: {
      label: "Approved, not on sale",
      cls: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400",
    },
    draft: {
      label: "Draft",
      cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    },
  }[course.review_status] ?? {
    label: "Draft",
    cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };

  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${look.cls}`}
    >
      {look.label}
    </span>
  );
}
