/**
 * Organisation administrators waiting for a super admin.
 *
 * A platform admin who makes somebody an organisation's administrator puts a
 * request here. A new account stays switched off, and a promotion stays
 * unapplied, until a super admin approves it (role model of 2026-10-01).
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface ApprovalRow {
  id: string;
  /** "new_account": made switched off. "promotion": an existing member raised. */
  kind: "new_account" | "promotion" | string;
  status: "pending" | "approved" | "declined" | string;
  requested_role: string;
  requested_at: string;
  user_id: string;
  user_name: string;
  user_email: string;
  organization_id: string;
  organization_name: string;
  requested_by_name: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export function listApprovals(): Promise<ApprovalRow[]> {
  return apiFetch<ApprovalRow[]>("/admin/approvals", authed);
}

export function decideApproval(
  id: string,
  approve: boolean,
  note?: string,
): Promise<ApprovalRow> {
  return apiFetch<ApprovalRow>(
    `/admin/approvals/${id}/${approve ? "approve" : "decline"}`,
    { ...authed, method: "POST", body: { note: note?.trim() || null } },
  );
}
