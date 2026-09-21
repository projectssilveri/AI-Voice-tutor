/**
 * Training reports.
 *
 * Read-only. Everything here is derived server-side from grouped queries, and
 * the export carries the same filters and the same scope as the screen — an
 * export that quietly ignored either would be a leak, not a convenience.
 */

import { apiFetch } from "@/lib/api";
import { API_V1, env } from "@/lib/env";

const authed = { withCredentials: true, cache: "no-store" } as const;

export type TrainingStatus = "completed" | "in_progress" | "not_started";

export interface TrainingRow {
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  organization_name: string | null;
  branch_name: string | null;
  department_name: string | null;

  course_id: string;
  course_title: string;

  status: TrainingStatus;
  modules_total: number;
  modules_completed: number;
  percent: number;

  enrolled_at: string | null;
  started_at: string | null;
  completed_at: string | null;

  /** The gap between these two is lessons opened and abandoned. */
  sessions_started: number;
  sessions_ended: number;
  tutor_minutes: number;

  quiz_attempts: number;
  best_quiz_score: number | null;

  exam_attempts: number;
  exam_passed: boolean;
  certificate_issued_at: string | null;
}

export interface TrainingSummary {
  people: number;
  courses: number;
  completed: number;
  in_progress: number;
  not_started: number;
  completion_rate: number;
}

export interface TrainingReport {
  summary: TrainingSummary;
  rows: TrainingRow[];
  truncated: boolean;
}

export interface ReportQuery {
  organization_id?: string;
  /**
   * Our own learners, and no customer's staff.
   *
   * Super admin only, and ignored for anybody else — a platform admin already
   * sees nothing but public accounts, and a customer's own staff already see
   * nothing but their own. It exists because the super admin's choice used to
   * be "everybody on the platform" or "one named company", so reading our own
   * numbers meant reading a mixed table and counting by eye.
   */
  public_only?: boolean;
  course_id?: string;
  status?: TrainingStatus;
  search?: string;
}

/** The dropdown value that means public B2C. Not a uuid, so it cannot collide. */
export const PUBLIC_SCOPE = "__public__";

export interface ReportCourse {
  id: string;
  title: string;
  enrolled: number;
}

function toParams(query: ReportQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // `false` is the default on the server and means nothing here, so it is
    // left out rather than sent as the string "false".
    if (value === false) continue;
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function getTrainingReport(
  query: ReportQuery = {},
): Promise<TrainingReport> {
  return apiFetch<TrainingReport>(
    `/reports/training${toParams(query)}`,
    authed,
  );
}

export function listReportCourses(
  organizationId?: string,
  publicOnly?: boolean,
): Promise<ReportCourse[]> {
  // Scoped the same way as the table, so the course dropdown never offers a
  // course that produces an empty report.
  return apiFetch<ReportCourse[]>(
    `/reports/courses${toParams({
      organization_id: organizationId,
      public_only: publicOnly,
    })}`,
    authed,
  );
}

/**
 * The URL of the spreadsheet for the current filters.
 *
 * A plain link rather than a fetch: the browser's own download handling reads
 * the filename from Content-Disposition, and the session cookie rides along
 * because it is same-site.
 */
export function trainingExportUrl(query: ReportQuery = {}): string {
  return `${env.apiBaseUrl}${API_V1}/reports/training/export${toParams(query)}`;
}

export const STATUS_LABEL: Record<TrainingStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  not_started: "Not started",
};
