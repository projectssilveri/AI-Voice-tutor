/**
 * Deletion requests from every customer, for platform staff to decide.
 *
 * Since 2026-10-01 a Platform Admin or Super Admin approves what anybody
 * inside a customer asks to delete: an organisation admin removing a learner
 * or another admin, and any course or document deleted from inside. Each
 * organisation's portal shows its own; this is all of them.
 */

import { apiFetch } from "@/lib/api";
import type { DeletionRequestRow } from "@/lib/orgPortal";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface StaffDeletionRow extends DeletionRequestRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
}

export function listAllDeletionRequests(
  includeDecided = false,
): Promise<StaffDeletionRow[]> {
  const query = includeDecided ? "?include_decided=true" : "";
  return apiFetch<StaffDeletionRow[]>(`/admin/deletion-requests${query}`, authed);
}

/** Agree. The thing is destroyed in the same transaction as the record of it. */
export function approveAnyDeletion(
  requestId: string,
  note?: string,
): Promise<StaffDeletionRow> {
  return apiFetch<StaffDeletionRow>(
    `/admin/deletion-requests/${requestId}/approve`,
    { ...authed, method: "POST", body: { note: note || null } },
  );
}

/** Refuse, with the reason the server requires. Nothing is touched. */
export function declineAnyDeletion(
  requestId: string,
  note: string,
): Promise<StaffDeletionRow> {
  return apiFetch<StaffDeletionRow>(
    `/admin/deletion-requests/${requestId}/decline`,
    { ...authed, method: "POST", body: { note } },
  );
}
