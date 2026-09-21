import { type CourseRow } from "@/lib/authoring";

/**
 * Whether finishing this course earns a certificate.
 *
 * Nothing on a course row implied it, and nothing on the course screens said
 * it either: the only way to find out was to open a course and look for the
 * certification panel, which is thirty clicks to answer "which of these have
 * an exam" (issue 74).
 *
 * Null renders nothing on purpose. It means the endpoint did not say, which
 * happens when a single course is fetched rather than a list, and "No exam"
 * would be a claim rather than a gap.
 */
export default function ExamBadge({ course }: { course: CourseRow }) {
  if (course.has_certification === null || course.has_certification === undefined) {
    return null;
  }

  return course.has_certification ? (
    <span className="rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-400">
      Certification
    </span>
  ) : (
    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
      No exam
    </span>
  );
}
