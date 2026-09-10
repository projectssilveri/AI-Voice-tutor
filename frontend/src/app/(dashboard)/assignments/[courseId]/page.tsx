"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import AssignmentCard from "@/components/assessments/AssignmentCard";
import RequireAuth from "@/components/auth/RequireAuth";
import { type StudentAssignment, listMyAssignments } from "@/lib/assignments";
import { SkeletonPanel } from "@/components/ui/Skeleton";
import { counted } from "@/lib/plural";
import EmptyState from "@/components/ui/EmptyState";
import { ActionLink } from "@/components/ui/Action";
import { errorText } from "@/lib/api";

/**
 * One course's assignments, grouped by the module that set them.
 *
 * Module headings rather than a flat run: an assignment only makes sense
 * beside the lesson it came from, and this is the order the student worked
 * through the course in.
 */
function CourseAssignments() {
  const { courseId } = useParams<{ courseId: string }>();

  const [items, setItems] = useState<StudentAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideComplete, setHideComplete] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await listMyAssignments();
      setItems(found.filter((item) => item.course_id === courseId));
      setError(null);
    } catch (caught) {
      setError(
        errorText(caught, "Could not load these assignments."),
      );
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const courseTitle = items[0]?.course_title ?? "";
  const outstanding = items.filter((item) => !item.is_complete).length;
  const visible = hideComplete
    ? items.filter((item) => !item.is_complete)
    : items;

  // Grouped by module, preserving the order the API returned — which is the
  // course's own module order.
  const byModule: {
    moduleId: string;
    title: string;
    rows: StudentAssignment[];
  }[] = [];
  for (const item of visible) {
    const last = byModule.find(
      (group) => group.moduleId === item.assignment.module_id,
    );
    if (last) last.rows.push(item);
    else
      byModule.push({
        moduleId: item.assignment.module_id,
        title: item.module_title,
        rows: [item],
      });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/assignments"
            className="mb-2 inline-block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            ← All courses
          </Link>
          <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
            {courseTitle || "Assignments"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {loading
              ? "Loading…"
              : items.length === 0
                ? "No assignments on this course."
                : `${outstanding} of ${counted(items.length, "assignment")} still to do.`}
          </p>
        </div>
        {items.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-400">
            <input
              type="checkbox"
              checked={hideComplete}
              onChange={(e) => setHideComplete(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-500 dark:text-brand-400 focus:ring-brand-500/20 dark:border-gray-700"
            />
            Hide completed
          </label>
        ) : null}
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
        <SkeletonPanel lines={4} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={items.length === 0 ? "✍️" : "🎉"}
          title={
            items.length === 0
              ? "No assignments on this course"
              : "Everything on this course is done"
          }
          body={
            items.length === 0
              ? "Nothing has been set here yet. The voice lecture and the quiz are still open."
              : "Every assignment is submitted and marked. Untick “Hide completed” to read them back."
          }
          action={
            <ActionLink href={`/learn/${courseId}`}>
              Back to the course
            </ActionLink>
          }
        />
      ) : (
        <div className="space-y-8">
          {byModule.map((group) => (
            <section key={group.moduleId}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
                  {group.title}
                </h2>
                <Link
                  href={`/learn/${courseId}/${group.moduleId}`}
                  className="shrink-0 text-sm text-brand-500 dark:text-brand-400 hover:text-brand-600"
                >
                  Open module →
                </Link>
              </div>
              <div className="space-y-4">
                {group.rows.map((item) => (
                  <AssignmentCard
                    key={item.assignment.id}
                    item={item}
                    onSubmitted={load}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CourseAssignmentsPage() {
  return (
    <RequireAuth>
      <CourseAssignments />
    </RequireAuth>
  );
}
