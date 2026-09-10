/**
 * The bundles and subscriptions the signed-in student holds.
 *
 * `/enrollments` answers "which courses am I taking". It cannot answer "what
 * did I buy", because enrolment is per course and knows nothing about the four
 * courses that arrived together as a stack. This is that second question.
 *
 * Scoped to the caller server-side — there is no id in the request to change.
 */

import { apiFetch } from "@/lib/api";

export interface BundleCourse {
  id: string;
  title: string;
  description: string | null;
  total_modules: number;
  completed_modules: number;
  in_progress_modules: number;
  percent_complete: number;
  /** A bundle unlocks a course; starting it is still a separate act. */
  enrolled: boolean;
}

export interface HeldPlan {
  subscription_id: string;
  plan_id: string;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  billing_interval: string;
  status: string;
  started_at: string;
  /** End of the current period. `cancelled` says whether it will renew. */
  renews_at: string;
  cancelled: boolean;
  covers_everything: boolean;
  course_count: number;
  completed_courses: number;
  courses: BundleCourse[];
}

export function listMyBundles(): Promise<HeldPlan[]> {
  return apiFetch<HeldPlan[]>("/subscriptions/mine", {
    withCredentials: true,
    cache: "no-store",
  });
}
