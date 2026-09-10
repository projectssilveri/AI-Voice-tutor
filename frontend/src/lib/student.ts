/**
 * Signed-in student API calls.
 *
 * Every request sends the session cookie. The backend re-checks enrolment and
 * role on each one — nothing here is trusted as a permission decision.
 */

import { apiFetch } from "@/lib/api";

export type ProgressStatus = "not_started" | "in_progress" | "completed";

export interface EnrolledCourse {
  id: string;
  title: string;
  description: string | null;
  total_modules: number;
  completed_modules: number;
  in_progress_modules: number;
  percent_complete: number;

  enrolled_at: string | null;
  /** When they paid. Null on a free course or a plain enrolment. */
  purchased_at: string | null;
  /** Null on an outright purchase means never, not unknown — see access_via. */
  expires_at: string | null;
  access_via: "purchase" | "subscription" | "free" | "enrolled" | string;
}

export interface ModuleSummary {
  id: string;
  course_id: string;
  title: string;
  order: number;
  has_content: boolean;
  status: ProgressStatus;
  /** What is inside, so the course page can link straight to each part. */
  estimated_minutes: number;
  quiz_questions: number;
  assignments: number;
  materials: number;
  /** Times this student has already played the tutor on this module. */
  tutor_sessions_used: number;
}

export interface CourseDetail {
  id: string;
  title: string;
  description: string | null;
  enrolled: boolean;
  modules: ModuleSummary[];
  price_minor: number;
  currency: string;
  /** Free, bought, subscribed, or staff. Separate from `enrolled`. */
  has_access: boolean;
  access_reason:
    "free" | "purchased" | "subscription" | "staff" | "payment_required";
  /** When they paid. Null on a free course or a plain enrolment. */
  purchased_at: string | null;
  /** Null with access_via "purchase" means never, not unknown. */
  expires_at: string | null;
  access_via: "purchase" | "subscription" | "free" | "enrolled" | string;

  /**
   * What the AI tutor allows on this course, resolved by the server.
   *
   * Per MODULE, not per course: `effective_ai_sessions_per_module` of 3 means
   * three plays on each module, not three across the whole course.
   */
  effective_ai_sessions_per_module: number;
  effective_ai_session_minutes: number;
}

export interface ModuleDetail {
  id: string;
  course_id: string;
  title: string;
  order: number;
  content: string | null;
}

const authed = { withCredentials: true, cache: "no-store" } as const;

export function listMyCourses(): Promise<EnrolledCourse[]> {
  return apiFetch<EnrolledCourse[]>("/enrollments", authed);
}

export interface CourseListRow {
  id: string;
  title: string;
  description: string | null;
  price_minor: number;
  currency: string;
  is_published: boolean;
  module_count: number | null;
}

export function getCourse(courseId: string): Promise<CourseDetail> {
  return apiFetch<CourseDetail>(`/courses/${courseId}`, authed);
}

export function getModule(moduleId: string): Promise<ModuleDetail> {
  return apiFetch<ModuleDetail>(`/modules/${moduleId}`, authed);
}

/**
 * Mark a module complete, or reopen it.
 *
 * Completing does not lock anything — the material stays readable and the
 * tutor stays available. The spec caps certification attempts and nothing
 * else.
 */
export function setModuleProgress(
  moduleId: string,
  status: "completed" | "in_progress",
): Promise<{ module_id: string; status: ProgressStatus }> {
  return apiFetch(`/modules/${moduleId}/progress`, {
    ...authed,
    method: "PUT",
    body: { status },
  });
}

export function enroll(courseId: string): Promise<{ status: string }> {
  return apiFetch(`/courses/${courseId}/enroll`, {
    ...authed,
    method: "POST",
  });
}

export function unenroll(courseId: string): Promise<void> {
  return apiFetch(`/courses/${courseId}/enroll`, {
    ...authed,
    method: "DELETE",
  });
}
