/**
 * Changes a branch manager or department admin asked for, for the org admin.
 *
 * Sir's rule of 2026-10-01: the org admin runs their organisation and approves
 * what the managers ask to do (create, edit or delete a person, course or
 * document). The org admin and platform staff act directly and never appear
 * here. Backed by `services/org_changes.py`.
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface OrgChangeRow {
  id: string;
  /** member | training | document */
  kind: string;
  /** create | edit | delete */
  action: string;
  label: string;
  reason: string;
  status: string;
  requested_at: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
  /** You raised this, so another administrator decides it. */
  requested_by_me: boolean;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  outcome: string | null;
}

export function listOrgChanges(
  slug: string,
  includeDecided = false,
): Promise<OrgChangeRow[]> {
  const query = includeDecided ? "?include_decided=true" : "";
  return apiFetch<OrgChangeRow[]>(
    `/org/${slug}/change-requests${query}`,
    authed,
  );
}

export function approveOrgChange(
  slug: string,
  id: string,
  note?: string,
): Promise<OrgChangeRow> {
  return apiFetch<OrgChangeRow>(`/org/${slug}/change-requests/${id}/approve`, {
    ...authed,
    method: "POST",
    body: { note: note?.trim() || null },
  });
}

export function declineOrgChange(
  slug: string,
  id: string,
  note: string,
): Promise<OrgChangeRow> {
  return apiFetch<OrgChangeRow>(`/org/${slug}/change-requests/${id}/decline`, {
    ...authed,
    method: "POST",
    body: { note },
  });
}
