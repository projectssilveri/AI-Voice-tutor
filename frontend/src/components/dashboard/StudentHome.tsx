"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AreaChart, BarChart, DonutChart } from "@/components/charts/Charts";
import MyBundles from "@/components/dashboard/MyBundles";
import {
  CourseCard,
  DashboardHeader,
  ErrorBanner,
  Panel,
  StatTile,
} from "@/components/dashboard/Tiles";
import { useAuth } from "@/context/AuthContext";
import { type MyProgress, getMyProgress, shortDay } from "@/lib/analytics";
import { type StudentAssignment, listMyAssignments } from "@/lib/assignments";
import { type EnrolledCourse, listMyCourses } from "@/lib/student";
import { counted } from "@/lib/plural";
import { errorText } from "@/lib/api";

/**
 * The learner's home.
 *
 * Ordered the way someone actually arrives: what am I in the middle of, how am
 * I doing, what is outstanding. The "continue learning" row is first because
 * resuming is the single most common reason to open this page.
 */
export default function StudentHome() {
  const { user } = useAuth();

  const [courses, setCourses] = useState<EnrolledCourse[]>([]);
  const [progress, setProgress] = useState<MyProgress | null>(null);
  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextCourses, nextProgress, nextAssignments] = await Promise.all([
          listMyCourses(),
          getMyProgress(),
          listMyAssignments(),
        ]);
        if (cancelled) return;
        setCourses(nextCourses);
        setProgress(nextProgress);
        setAssignments(nextAssignments);
      } catch (caught) {
        if (!cancelled) {
          setError(
            errorText(caught, "Could not load your dashboard."),
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

  const outstanding = assignments.filter((item) => !item.is_complete);
  const inProgress = courses.filter(
    (course) => course.percent_complete > 0 && course.percent_complete < 100,
  );
  const continueLearning = (inProgress.length > 0 ? inProgress : courses).slice(
    0,
    3,
  );

  const firstName = (user?.name ?? "").split(" ")[0] || "there";

  return (
    <div className="space-y-6">
      <DashboardHeader
        title={`Welcome back, ${firstName}`}
        subtitle={
          progress && progress.current_streak_days > 1
            ? `${progress.current_streak_days} days in a row. Keep it going.`
            : "Pick up where you left off, or start something new."
        }
        action={
          <Link
            href="/learn"
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            Browse courses
          </Link>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {/* Resume — the first thing a returning student sees.
          Above the KPI tiles on purpose: the reason most people open this page
          is to carry on, and making them scan statistics first to find their
          place is the friction this removes. Opens in a new tab like every
          other route into a session, because a live call is lost the moment
          the page unmounts. */}
      {progress?.last_module ? (
        <button
          type="button"
          onClick={() =>
            window.open(
              `/learn/${progress.last_module!.course_id}/${progress.last_module!.module_id}`,
              "_blank",
              "noopener,noreferrer",
            )
          }
          className="group flex w-full flex-wrap items-center gap-5 rounded-2xl border border-brand-300 bg-brand-25 p-5 text-left shadow-raised transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-brand-400 hover:bg-brand-50 hover:shadow-lifted dark:border-brand-700 dark:bg-brand-500/10 dark:hover:bg-brand-500/20"
        >
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-500 text-2xl transition-transform duration-300 ease-[var(--ease-spring)] group-hover:scale-110"
          >
            🎙️
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
              {progress.last_module.status === "completed"
                ? "Pick up again"
                : "Continue where you left off"}
            </span>
            <span className="mt-0.5 block truncate text-lg font-semibold text-gray-800 dark:text-white/90">
              {progress.last_module.module_title}
            </span>
            <span className="block truncate text-sm text-gray-500 dark:text-gray-400">
              {progress.last_module.course_title} · Module{" "}
              {progress.last_module.module_number} of{" "}
              {progress.last_module.module_count}
            </span>
          </span>
          <span className="shrink-0 rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white transition group-hover:bg-brand-600">
            Resume lecture ↗
          </span>
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Courses"
          value={progress?.courses_enrolled ?? 0}
          loading={loading}
        />
        <StatTile
          label="Modules done"
          value={`${progress?.modules_completed ?? 0}/${progress?.modules_total ?? 0}`}
          loading={loading}
          tone="success"
        />
        <StatTile
          label="Tutor minutes"
          value={progress?.voice_minutes ?? 0}
          loading={loading}
        />
        <StatTile
          label="Questions asked"
          value={progress?.questions_asked ?? 0}
          hint="Times you interrupted"
          loading={loading}
        />
        <StatTile
          label="Day streak"
          value={progress?.current_streak_days ?? 0}
          loading={loading}
          tone="warning"
        />
        <StatTile
          label="Certificates"
          value={progress?.certificates_earned ?? 0}
          loading={loading}
          tone="brand"
        />
      </div>

      {/* WHAT IS UNDERWAY, not "your courses".
          The panel was headed "Your courses / Your enrolled courses" and then
          showed the in-progress ones anyway — a heading that promised a list
          and a body that gave a different one. It now says what it shows, and
          leads with how far through each course is, which is the reason to
          open this panel at all.

          Still not called "Continue learning": the resume banner above already
          carries that heading, and two of them on one screen is the repetition
          this app has been cleaned of elsewhere. */}
      <Panel
        title="Your progress"
        subtitle={
          courses.length === 0
            ? "You are not enrolled in anything yet."
            : inProgress.length > 0
              ? `${counted(inProgress.length, "course")} underway.`
              : "Nothing started yet. Open one and the tutor begins."
        }
        action={
          <Link
            href="/learn"
            className="text-sm font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600"
          >
            See all
          </Link>
        }
      >
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((n) => (
              <div
                key={n}
                className="h-56 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.04]"
              />
            ))}
          </div>
        ) : courses.length === 0 ? (
          <div className="py-8 text-center">
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Enrol in a course and the tutor starts teaching it out loud.
            </p>
            <Link
              href="/learn"
              className="inline-flex rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Find a course
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {continueLearning.map((course, index) => (
              <CourseCard
                key={course.id}
                href={`/learn/${course.id}`}
                title={course.title}
                description={course.description}
                meta={`${course.completed_modules} of ${counted(course.total_modules, "module")}`}
                percent={course.percent_complete}
                accent={index}
                actionLabel={
                  course.percent_complete > 0 ? "Continue" : "Start course"
                }
              />
            ))}
          </div>
        )}
      </Panel>

      {/* WHAT THEY BOUGHT, as opposed to what they are part-way through.
          A stack bundle puts three or four courses on the account at once, and
          until this panel existed nothing on the dashboard said they arrived
          together, what the bundle was called, or when it renews — the courses
          simply appeared, indistinguishable from ones bought one at a time.
          Renders nothing for a student holding no subscription, which is most
          of them. */}
      <MyBundles />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Your activity"
          subtitle="Minutes with the tutor, last 30 days"
          className="lg:col-span-2"
        >
          <AreaChart
            points={(progress?.activity ?? []).map((point) => ({
              label: shortDay(point.day),
              value: point.value,
            }))}
            valueSuffix="m"
            emptyMessage="No tutor sessions in this period. Start a module and this fills in."
          />
        </Panel>

        <Panel title="Module status" subtitle="Across your courses">
          <DonutChart
            centreLabel="Modules"
            points={[
              {
                label: "Completed",
                value: progress?.modules_completed ?? 0,
              },
              {
                label: "In progress",
                value: progress?.modules_in_progress ?? 0,
              },
              {
                label: "Not started",
                value: Math.max(
                  0,
                  (progress?.modules_total ?? 0) -
                    (progress?.modules_completed ?? 0) -
                    (progress?.modules_in_progress ?? 0),
                ),
              },
            ]}
            emptyMessage="Enrol in a course to see this."
          />
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Where your time goes" subtitle="Tutor minutes per course">
          <BarChart
            points={(progress?.minutes_per_course ?? []).map((row) => ({
              label: row.label,
              value: row.value,
            }))}
            horizontal
            valueSuffix=" min"
            emptyMessage="No tutor sessions yet."
          />
        </Panel>

        <Panel
          title="Assignments"
          subtitle={
            outstanding.length === 0
              ? "Nothing outstanding."
              : `${outstanding.length} still to do.`
          }
          action={
            <Link
              href="/assignments"
              className="text-sm font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600"
            >
              See all
            </Link>
          }
        >
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : outstanding.length === 0 ? (
            <p className="py-6 text-center text-sm text-success-600 dark:text-success-400">
              {assignments.length === 0
                ? "No assignments on your courses yet."
                : "Everything is done. Nice work."}
            </p>
          ) : (
            <ul className="space-y-3">
              {outstanding.slice(0, 4).map((item) => (
                <li key={item.assignment.id}>
                  <Link
                    href={`/learn/${item.course_id}/${item.assignment.module_id}/assignment`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 transition hover:border-brand-300 dark:border-gray-800 dark:hover:border-brand-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-800 dark:text-white/90">
                        {item.assignment.title}
                      </span>
                      <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                        {item.course_title} · {item.module_title}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        item.submissions.length > 0
                          ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-orange-400"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {item.submissions.length > 0 ? "Try again" : "To do"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
