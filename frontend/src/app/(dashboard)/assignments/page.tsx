"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import { type StudentAssignment, listMyAssignments } from "@/lib/assignments";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { counted } from "@/lib/plural";
import ProgressBar from "@/components/ui/ProgressBar";
import EmptyState from "@/components/ui/EmptyState";
import { ActionLink } from "@/components/ui/Action";
import { errorText } from "@/lib/api";

interface CourseGroup {
  courseId: string;
  courseTitle: string;
  total: number;
  done: number;
  modules: number;
}

/**
 * Assignments, by course.
 *
 * This used to be one flat list of every assignment on every enrolled course.
 * That reads as a platform-wide to-do rather than coursework: a student thinks
 * "what is left in JavaScript Foundations", not "what is my 14th task". The
 * grouping is done here rather than in a new endpoint — `/assignments/mine`
 * already returns `course_id` and `course_title` on every row (one grouped
 * query, decision 45), so a per-course API would be a second round trip for
 * data we already hold.
 */
function AssignmentCourses() {
  const [items, setItems] = useState<StudentAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await listMyAssignments();
        if (!cancelled) {
          setItems(found);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            errorText(caught, "Could not load your assignments."),
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

  const groups = new Map<string, CourseGroup & { moduleIds: Set<string> }>();
  for (const item of items) {
    let group = groups.get(item.course_id);
    if (!group) {
      group = {
        courseId: item.course_id,
        courseTitle: item.course_title,
        total: 0,
        done: 0,
        modules: 0,
        moduleIds: new Set<string>(),
      };
      groups.set(item.course_id, group);
    }
    group.total += 1;
    if (item.is_complete) group.done += 1;
    group.moduleIds.add(item.assignment.module_id);
  }
  const courses = [...groups.values()]
    .map((group) => ({ ...group, modules: group.moduleIds.size }))
    // Courses with work outstanding first: the reason to open this page is
    // almost always the unfinished half.
    .sort((a, b) => b.total - b.done - (a.total - a.done));

  const outstanding = items.filter((item) => !item.is_complete).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          Assignments
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {loading
            ? "Loading your courses…"
            : items.length === 0
              ? "Nothing set yet."
              : `${outstanding} still to do across ${counted(courses.length, "course")}.`}
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <SkeletonCards count={3} />
      ) : courses.length === 0 ? (
        <EmptyState
          icon="✍️"
          title="No assignments yet"
          body="Assignments appear here as you work through a course. They are marked the moment you submit, and you can resubmit as often as you like."
          action={<ActionLink href="/learn">Browse your courses</ActionLink>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => {
            const left = course.total - course.done;
            const percent = Math.round((course.done / course.total) * 100);
            return (
              <Link
                key={course.courseId}
                href={`/assignments/${course.courseId}`}
                className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-800"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h2 className="font-semibold text-gray-800 group-hover:text-brand-600 dark:text-white/90 dark:group-hover:text-brand-400">
                    {course.courseTitle}
                  </h2>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      left === 0
                        ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                        : "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400"
                    }`}
                  >
                    {left === 0 ? "All done" : `${left} to do`}
                  </span>
                </div>

                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                  {counted(course.total, "assignment")} across{" "}
                  {counted(course.modules, "module")}
                </p>

                <div className="mt-auto">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>
                      {course.done} of {course.total} complete
                    </span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {percent}%
                    </span>
                  </div>
                  <ProgressBar
                    value={percent}
                    tone={left === 0 ? "success" : "brand"}
                    label={`${course.done} of ${course.total} assignments complete`}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AssignmentsPage() {
  return (
    <RequireAuth>
      <AssignmentCourses />
    </RequireAuth>
  );
}
