/**
 * When a course was bought, and when it runs out.
 *
 * "Never" is a real answer here, not a missing one: a course bought outright
 * does not expire, and printing an em dash would leave the student guessing
 * whether we simply do not know. A subscription shows the real end date, and
 * goes amber in its last two weeks — the point of showing an expiry at all is
 * that somebody acts on it before it passes.
 *
 * A course nobody paid for shows nothing. Inventing a purchase date for a free
 * course, or for one an admin simply enrolled somebody in, would be a number
 * that looks like a fact.
 */

const DAY = 24 * 60 * 60 * 1000;
const SOON_DAYS = 14;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export interface CourseAccess {
  purchased_at: string | null;
  expires_at: string | null;
  access_via: string;
}

export default function CourseAccessNote({
  course,
  className = "",
}: {
  course: CourseAccess;
  className?: string;
}) {
  if (!course.purchased_at && course.access_via !== "subscription") return null;

  const expiring = course.expires_at
    ? (new Date(course.expires_at).getTime() - Date.now()) / DAY
    : null;
  const lapsed = expiring !== null && expiring < 0;
  const soon = expiring !== null && expiring >= 0 && expiring <= SOON_DAYS;

  return (
    <p
      className={`mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400 ${className}`}
    >
      {course.purchased_at ? (
        <span>
          {course.access_via === "subscription" ? "Started" : "Bought"}{" "}
          {day(course.purchased_at)}
        </span>
      ) : null}
      {course.expires_at ? (
        <span
          className={
            lapsed
              ? "font-medium text-error-600 dark:text-error-400"
              : soon
                ? "font-medium text-warning-600 dark:text-warning-400"
                : ""
          }
        >
          {lapsed ? "Ran out" : "Runs out"} {day(course.expires_at)}
        </span>
      ) : course.access_via === "purchase" ? (
        <span className="text-success-600 dark:text-success-400">
          Yours for good
        </span>
      ) : null}
    </p>
  );
}
