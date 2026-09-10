"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import ProgressBar from "@/components/ui/ProgressBar";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { type Organization, listOrganizations } from "@/lib/organizations";
import { counted } from "@/lib/plural";
import {
  type ReportCourse,
  type ReportQuery,
  STATUS_LABEL,
  type TrainingReport,
  type TrainingStatus,
  getTrainingReport,
  listReportCourses,
  trainingExportUrl,
} from "@/lib/reports";

/**
 * Who has done the training, and who has not.
 *
 * The dashboard showed totals and the user record showed one person; neither
 * answers the question a training manager actually has, which is "give me the
 * list of people who still have not finished the compliance module". This is
 * that list, filterable, with a spreadsheet button on it.
 *
 * The three status counts are clickable, because "47 not started" is a number
 * whose only useful next action is seeing which 47.
 */

const CELL = "px-4 py-3 align-middle text-sm";
const FIELD =
  "h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

const STATUS_TONE: Record<TrainingStatus, string> = {
  completed:
    "bg-success-50 text-success-800 dark:bg-success-500/15 dark:text-success-400",
  in_progress:
    "bg-warning-50 text-warning-900 dark:bg-warning-500/15 dark:text-warning-300",
  not_started: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function day(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Kpi({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-gray-800 dark:text-white/90">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      ) : null}
    </>
  );

  const shell = `rounded-2xl border bg-white p-4 text-left shadow-raised transition dark:bg-white/[0.03] ${
    active
      ? "border-brand-500 ring-2 ring-brand-500/20"
      : "border-gray-200 dark:border-gray-800"
  }`;

  // A count you can act on is a button; one you cannot is a div. Making
  // everything a button so the row looks consistent would promise an action
  // that four of these do not have.
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${shell} hover:border-brand-300`}
    >
      {inner}
    </button>
  ) : (
    <div className={shell}>{inner}</div>
  );
}

function Reports() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [report, setReport] = useState<TrainingReport | null>(null);
  const [courses, setCourses] = useState<ReportCourse[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReportQuery>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await getTrainingReport(filters));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not build the report.",
      );
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    // Debounced, because the search box fires on every keystroke and this is
    // the heaviest query in the product.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    listReportCourses(filters.organization_id)
      .then(setCourses)
      .catch(() => {
        // The course filter is a convenience. Losing it must not take the
        // report down with it.
      });
  }, [filters.organization_id]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    listOrganizations()
      .then(setOrganizations)
      .catch(() => {});
  }, [isSuperAdmin]);

  function set<K extends keyof ReportQuery>(key: K, value: ReportQuery[K]) {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  function toggleStatus(status: TrainingStatus) {
    setFilters((current) => ({
      ...current,
      status: current.status === status ? undefined : status,
    }));
  }

  const summary = report?.summary;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            Training report
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Who has finished, who is part-way through, and who has not started.
            {isSuperAdmin ? " Every organisation, unless you narrow it." : ""}
          </p>
        </div>
        <a
          href={trainingExportUrl(filters)}
          className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
        >
          Download spreadsheet
        </a>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <input
          value={filters.search ?? ""}
          onChange={(event) => set("search", event.target.value)}
          placeholder="Search a name or email"
          className={`${FIELD} min-w-56 flex-1`}
        />
        <select
          value={filters.course_id ?? ""}
          onChange={(event) => set("course_id", event.target.value)}
          aria-label="Filter by course"
          className={FIELD}
        >
          <option value="">Every course</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title} ({course.enrolled})
            </option>
          ))}
        </select>
        {isSuperAdmin && organizations.length > 0 ? (
          <select
            value={filters.organization_id ?? ""}
            onChange={(event) => set("organization_id", event.target.value)}
            aria-label="Filter by organisation"
            className={FIELD}
          >
            <option value="">Every organisation</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        ) : null}
        {Object.values(filters).some(Boolean) ? (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {summary ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="People" value={summary.people} />
          <Kpi
            label="Completed"
            value={summary.completed}
            hint="Show only these"
            active={filters.status === "completed"}
            onClick={() => toggleStatus("completed")}
          />
          <Kpi
            label="In progress"
            value={summary.in_progress}
            hint="Show only these"
            active={filters.status === "in_progress"}
            onClick={() => toggleStatus("in_progress")}
          />
          <Kpi
            label="Not started"
            value={summary.not_started}
            hint="Show only these"
            active={filters.status === "not_started"}
            onClick={() => toggleStatus("not_started")}
          />
          <Kpi
            label="Completion"
            value={`${summary.completion_rate}%`}
            hint={counted(summary.courses, "course")}
          />
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <SkeletonRows rows={8} />
      ) : !report || report.rows.length === 0 ? (
        <EmptyState
          icon="📊"
          title="Nothing to report yet"
          body={
            Object.values(filters).some(Boolean)
              ? "Nothing matches those filters."
              : "Once people are enrolled on a course, their progress appears here."
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[76rem]">
                <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3">Person</th>
                    <th className="px-4 py-3">Course</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Progress</th>
                    <th className="px-4 py-3">Tutor</th>
                    <th className="px-4 py-3">Quiz</th>
                    <th className="px-4 py-3">Exam</th>
                    <th className="px-4 py-3">Enrolled</th>
                    <th className="px-4 py-3">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {report.rows.map((row) => (
                    <tr
                      key={`${row.user_id}-${row.course_id}`}
                      className="hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                    >
                      <td className={CELL}>
                        <div className="flex items-center gap-3">
                          <Avatar
                            userId={row.user_id}
                            name={row.user_name}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/admin/users/${row.user_id}`}
                              className="block truncate font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                            >
                              {row.user_name}
                            </Link>
                            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                              {row.user_email}
                            </span>
                            {row.organization_name || row.department_name ? (
                              <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                                {[
                                  row.organization_name,
                                  row.branch_name,
                                  row.department_name,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td
                        className={`${CELL} text-gray-800 dark:text-white/90`}
                      >
                        {row.course_title}
                      </td>
                      <td className={CELL}>
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[row.status]}`}
                        >
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                      <td className={`${CELL} min-w-40`}>
                        <ProgressBar
                          value={row.percent}
                          tone={
                            row.status === "completed" ? "success" : "brand"
                          }
                          className="h-1.5"
                          label={`${row.percent}% of ${row.course_title}`}
                        />
                        <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                          {row.modules_completed}/{row.modules_total} modules
                        </span>
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {row.sessions_started === 0 ? (
                          <span className="text-gray-500 dark:text-gray-400">
                            Never used
                          </span>
                        ) : (
                          <>
                            {row.tutor_minutes} min
                            <span className="block text-xs">
                              {row.sessions_ended} of {row.sessions_started}{" "}
                              finished
                            </span>
                          </>
                        )}
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {row.quiz_attempts === 0
                          ? "Not taken"
                          : `${row.best_quiz_score ?? 0}% best`}
                      </td>
                      <td className={`${CELL} whitespace-nowrap`}>
                        {row.exam_attempts === 0 ? (
                          <span className="text-gray-500 dark:text-gray-400">
                            Not sat
                          </span>
                        ) : row.exam_passed ? (
                          <span className="text-success-800 dark:text-success-400">
                            Passed
                          </span>
                        ) : (
                          <span className="text-error-700 dark:text-error-400">
                            {counted(row.exam_attempts, "attempt")}, not passed
                          </span>
                        )}
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-500 dark:text-gray-400`}
                      >
                        {day(row.enrolled_at)}
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-500 dark:text-gray-400`}
                      >
                        {day(row.completed_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            {counted(report.rows.length, "row")} shown.
            {report.truncated
              ? " This is more than the screen will hold. Narrow the filters, or download the spreadsheet for the lot."
              : ""}
          </p>
        </>
      )}
    </div>
  );
}

export default function AdminReportsPage() {
  return (
    <RequireAuth roles={["admin", "teacher"]}>
      <Reports />
    </RequireAuth>
  );
}
