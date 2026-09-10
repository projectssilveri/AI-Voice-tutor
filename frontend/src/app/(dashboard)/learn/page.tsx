"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SkeletonCards } from "@/components/ui/Skeleton";
import { counted } from "@/lib/plural";
import CourseAccessNote from "@/components/dashboard/CourseAccessNote";
import { type EnrolledCourse, listMyCourses } from "@/lib/student";
import ProgressBar from "@/components/ui/ProgressBar";
import { errorText } from "@/lib/api";

/**
 * The student's courses — ENROLLED ONLY.
 *
 * This used to list the whole catalogue, which made the dashboard a second
 * shop window competing with the public site: two places showing prices, two
 * places to buy, and a student's own courses buried among ones they had not
 * bought. Browsing and buying now happen in one place — /courses on the public
 * site — and this screen is only what they are actually studying.
 */
export default function LearnIndexPage() {
  const [courses, setCourses] = useState<EnrolledCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mine = await listMyCourses();
        if (!cancelled) setCourses(mine);
      } catch (caught) {
        if (!cancelled) {
          setError(
            errorText(caught, "Could not load your courses."),
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
            My courses
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Everything you are enrolled in. Open one to start a voice lecture.
          </p>
        </div>
        <Link
          href="/courses"
          className="shrink-0 rounded-lg border border-brand-500 px-5 py-2.5 text-sm font-medium text-brand-500 dark:text-brand-400 transition hover:bg-brand-50 dark:hover:bg-brand-500/10"
        >
          Browse all courses
        </Link>
      </div>

      {error ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      ) : null}

      {loading ? (
        <SkeletonCards count={3} columns={3} />
      ) : courses.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
            You are not enrolled in anything yet
          </p>
          <p className="mx-auto mb-6 max-w-md text-sm text-gray-500 dark:text-gray-400">
            Pick a course and the tutor starts teaching it out loud, module by
            module. There is a free one to try.
          </p>
          <Link
            href="/courses"
            className="inline-flex rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            Browse courses
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <Link
              key={course.id}
              href={`/learn/${course.id}`}
              className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-800"
            >
              <h2 className="mb-1 font-semibold text-gray-800 dark:text-white/90">
                {course.title}
              </h2>
              {course.description ? (
                <p className="mb-4 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
                  {course.description}
                </p>
              ) : null}

              <div className="mt-auto">
                <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>
                    {course.completed_modules} of{" "}
                    {counted(course.total_modules, "module")}
                  </span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {course.percent_complete}%
                  </span>
                </div>
                <ProgressBar
                  value={course.percent_complete}
                  className="h-1.5"
                  label={`${course.percent_complete}% of ${course.title} complete`}
                />
                <CourseAccessNote course={course} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
