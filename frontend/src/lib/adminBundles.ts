/**
 * Bundles and packages, for the super admin.
 *
 * Super admin only on both sides — the routes 403 anyone else, and this screen
 * shows revenue per bundle and names the customers on it.
 */

import { apiFetch } from "@/lib/api";

export interface BundleCourse {
  id: string;
  title: string;
  price_minor: number;
  is_published: boolean;
}

export interface Bundle {
  id: string;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  billing_interval: string;
  is_active: boolean;
  created_at: string;

  courses: BundleCourse[];
  course_count: number;
  /** Covers the whole published catalogue — All Access rather than a stack. */
  covers_everything: boolean;
  /** Flagged All Access: every public course is in it automatically,
   * including courses created later. */
  all_access: boolean;
  /** What those courses cost bought one at a time, at today's prices. */
  separate_total_minor: number;

  active_subscribers: number;
  total_subscribers: number;
  paid_orders: number;
  /** Money taken, including orders since refunded. */
  gross_minor: number;
  refunded_minor: number;
  net_minor: number;
}

export interface BundleHolder {
  user_id: string;
  name: string;
  email: string;
  /**
   * A subscription status, or `paid_not_granted`.
   *
   * That last one is somebody who paid and holds no subscription — money taken
   * and nothing given. It is listed rather than filtered out because that is
   * the only way anybody would notice it.
   */
  status: string;
  started_at: string | null;
  period_end: string | null;
  cancelled: boolean;
  /** Whether it is still granting access right now. */
  live: boolean;
  paid_minor: number;
  orders: number;
}

export interface BundleInput {
  name?: string;
  description?: string | null;
  price_minor?: number;
  currency?: string;
  billing_interval?: string;
  is_active?: boolean;
  /**
   * Which courses the bundle covers.
   *
   * OMIT to leave the membership alone; send a list to replace it. An empty
   * list genuinely empties the bundle — those are different intentions and the
   * server tells them apart, so this must not send `[]` for "no change".
   */
  course_ids?: string[];
  /** Every public course, now and later. The server links them; the picker is
   * not consulted while this is on. */
  all_access?: boolean;
}

const authed = { withCredentials: true, cache: "no-store" } as const;

export function listBundles(): Promise<Bundle[]> {
  return apiFetch<Bundle[]>("/admin/bundles", authed);
}

export function listBundleHolders(planId: string): Promise<BundleHolder[]> {
  return apiFetch<BundleHolder[]>(`/admin/bundles/${planId}/holders`, authed);
}

export function createBundle(input: BundleInput): Promise<Bundle> {
  return apiFetch<Bundle>("/admin/bundles", {
    ...authed,
    method: "POST",
    body: input,
  });
}

export function updateBundle(
  planId: string,
  input: BundleInput,
): Promise<Bundle> {
  return apiFetch<Bundle>(`/admin/bundles/${planId}`, {
    ...authed,
    method: "PATCH",
    body: input,
  });
}
