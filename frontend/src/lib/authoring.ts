/**
 * Course and module authoring.
 *
 * Step 5 asks for "a basic admin screen to create courses and add
 * modules with content text". `modules.content` is what grounds the AI tutor,
 * so this is the screen that decides what the tutor is able to teach — every
 * route behind it is admin-gated server-side.
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface CourseRow {
  id: string;
  /**
   * Null for a marketplace course; set for one customer's private training.
   *
   * A super admin's listing spans both, so any screen about the PUBLIC site
   * has to filter on this — org training never appears on the catalogue.
   */
  organization_id: string | null;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  /** Integer minor units (paise). 0 means free. */
  price_minor: number;
  /** A price the course genuinely carried before. Null for most of them. */
  list_price_minor: number | null;
  /** Days a purchase lasts. Null means it never expires. */
  access_days: number | null;
  /**
   * What `access_days` would be for a course this size, from the server.
   *
   * Not recomputed here on purpose: the formula also lives in the entitlement
   * service and in the migration that backfilled it, and a third copy in the
   * browser is how the admin screen would come to suggest a number the data
   * does not agree with.
   */
  suggested_access_days: number | null;
  currency: string;
  is_published: boolean;
  /** Present on the list endpoint; null when a single course is fetched. */
  module_count: number | null;
  /**
   * Whether finishing this course earns a certificate.
   *
   * List endpoint only, like `module_count`. Null means "not stated here",
   * which is not the same as "no exam", so the badge stays off rather than
   * claiming a course has nothing.
   */
  has_certification: boolean | null;

  // --- What the AI tutor may do -------------------------------------------
  /** Per-course override: plays per module. Null means the platform default. */
  ai_sessions_per_module: number | null;
  /** Per-course override: minutes per play. Null means the platform default. */
  ai_session_minutes: number | null;
  /**
   * What those actually resolve to, from the server.
   *
   * Not derived here, for the same reason as `suggested_access_days`: the free
   * and paid defaults are backend config, and a copy in the browser would show
   * one number while the tutor enforced another.
   */
  effective_ai_sessions_per_module: number;
  effective_ai_session_minutes: number;
  /** Which default applied — "free" or "paid". */
  ai_limit_basis: string;

  // --- Approval ------------------------------------------------------------
  /** draft | pending | approved | rejected. */
  review_status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  /** Why it was sent back. Written for the author, so show it to them. */
  review_note: string | null;
}

export interface ModuleRow {
  id: string;
  course_id: string;
  title: string;
  order: number;
  content: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseInput {
  title: string;
  description: string | null;
}

/**
 * Super-admin only. Deliberately a separate call from `updateCourse`, because
 * it is a separate endpoint with a stricter gate: an admin authors a course,
 * a super admin decides what it costs and whether it is on sale.
 */
export interface CoursePricingInput {
  price_minor?: number;
  /**
   * The price the course used to carry, struck through beside the real one.
   *
   * The backend refuses anything at or below `price_minor`: a "was" figure
   * that is not higher is either a slip or a discount that never existed, and
   * the second is a deceptive trade practice rather than a design choice.
   * Send null to clear it.
   */
  list_price_minor?: number | null;
  /** Days a purchase lasts. 0 clears it — back to never expiring. */
  access_days?: number | null;
  currency?: string;
  is_published?: boolean;
}

export function updateCoursePricing(
  courseId: string,
  input: CoursePricingInput,
): Promise<CourseRow> {
  return apiFetch<CourseRow>(`/courses/${courseId}/pricing`, {
    ...authed,
    method: "PATCH",
    body: input,
  });
}

export interface CourseLimitsInput {
  /**
   * How many times a student may play the tutor on one module.
   *
   * Null CLEARS the override and puts the course back on the platform default
   * for its kind. 0 is a real value: no tutor on this course.
   */
  ai_sessions_per_module?: number | null;
  /** Minutes one play may run. Null clears the override. */
  ai_session_minutes?: number | null;
}

/** Super admin only — the server 403s anyone else. */
export function updateCourseLimits(
  courseId: string,
  input: CourseLimitsInput,
): Promise<CourseRow> {
  return apiFetch<CourseRow>(`/courses/${courseId}/limits`, {
    ...authed,
    method: "PATCH",
    body: input,
  });
}

/**
 * Hand a course to the super admin for approval.
 *
 * What an ordinary admin does instead of publishing — publishing is the
 * owner's, and always was. Refused on a course with no modules: there would be
 * nothing to review.
 */
export function submitCourseForReview(courseId: string): Promise<CourseRow> {
  return apiFetch<CourseRow>(`/courses/${courseId}/submit-for-review`, {
    ...authed,
    method: "POST",
  });
}

export interface ModuleInput {
  title: string;
  /**
   * Position within the course. Omit to append — the server reads the highest
   * position that exists and adds one. Both authoring screens used to compute
   * this themselves and they disagreed: one sent `max(order) + 1`, the other
   * the module COUNT, which collides as soon as a module has been deleted.
   */
  order?: number;
  content: string | null;
}

export function listCourses(): Promise<CourseRow[]> {
  return apiFetch<CourseRow[]>("/courses", authed);
}

export function createCourse(input: CourseInput): Promise<CourseRow> {
  return apiFetch<CourseRow>("/courses", {
    ...authed,
    method: "POST",
    body: input,
  });
}

export function updateCourse(
  courseId: string,
  input: Partial<CourseInput>,
): Promise<CourseRow> {
  return apiFetch<CourseRow>(`/courses/${courseId}`, {
    ...authed,
    method: "PATCH",
    body: input,
  });
}

/**
 * Delete a course, ours or a customer's. Platform staff only, and at once.
 *
 * `reason` is only read for a customer's course, where it goes on that
 * customer's own record of the deletion (2026-10-01).
 */
export function deleteCourse(courseId: string, reason?: string): Promise<void> {
  const qs = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  return apiFetch<void>(`/courses/${courseId}${qs}`, {
    ...authed,
    method: "DELETE",
  });
}

/**
 * Full modules including `content`. Deliberately not the dashboard's
 * `ModuleSummary`, which strips the grounding text — the author has to see and
 * edit the very thing that listing omits.
 */
export function listModules(courseId: string): Promise<ModuleRow[]> {
  return apiFetch<ModuleRow[]>(`/courses/${courseId}/modules`, authed);
}

export function createModule(
  courseId: string,
  input: ModuleInput,
): Promise<ModuleRow> {
  return apiFetch<ModuleRow>(`/courses/${courseId}/modules`, {
    ...authed,
    method: "POST",
    body: input,
  });
}

export function updateModule(
  moduleId: string,
  input: Partial<ModuleInput>,
): Promise<ModuleRow> {
  return apiFetch<ModuleRow>(`/modules/${moduleId}`, {
    ...authed,
    method: "PATCH",
    body: input,
  });
}

export function deleteModule(moduleId: string): Promise<void> {
  return apiFetch<void>(`/modules/${moduleId}`, {
    ...authed,
    method: "DELETE",
  });
}
