/**
 * The course approval queue, for the super admin.
 *
 * Super admin only on both sides. An ordinary admin submits a course from the
 * course editor; this is the other half — seeing what is waiting, and deciding.
 */

import { apiFetch } from "@/lib/api";

export interface ReviewRow {
  id: string;
  title: string;
  description: string | null;
  /** draft | pending | approved | rejected */
  review_status: string;
  module_count: number;
  price_minor: number;
  currency: string;
  is_published: boolean;

  submitted_at: string | null;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
}

const authed = { withCredentials: true, cache: "no-store" } as const;

export function listCourseReviews(status?: string): Promise<ReviewRow[]> {
  const query = status ? `?status_filter=${encodeURIComponent(status)}` : "";
  return apiFetch<ReviewRow[]>(`/admin/course-reviews${query}`, authed);
}

/** Approve, and put it on sale unless `publish` says otherwise. */
export function approveCourse(
  courseId: string,
  payload: { note?: string; publish?: boolean } = {},
): Promise<ReviewRow> {
  return apiFetch<ReviewRow>(`/admin/course-reviews/${courseId}/approve`, {
    ...authed,
    method: "POST",
    body: payload,
  });
}

/**
 * Send it back with a reason.
 *
 * The note is required — the server refuses an empty one. "Rejected" with no
 * reason leaves the author guessing, and their next submission is a guess too.
 */
export function rejectCourse(
  courseId: string,
  note: string,
): Promise<ReviewRow> {
  return apiFetch<ReviewRow>(`/admin/course-reviews/${courseId}/reject`, {
    ...authed,
    method: "POST",
    body: { note },
  });
}
