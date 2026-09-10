/**
 * The compliance audit trail.
 *
 * Read-only from the frontend by design: events are written server-side, by the
 * middleware and by the services that know what happened. There is deliberately
 * no "create event" call here — a trail a browser can write to is a trail an
 * attacker can write to.
 */

import { apiFetch } from "@/lib/api";
import { API_V1, env } from "@/lib/env";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface AuditEvent {
  id: string;
  action: string;
  created_at: string;
  actor_user_id: string | null;
  /** Null when the event had no signed-in actor — a failed login, say. */
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  organization_id: string | null;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AuditPage {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditQuery {
  limit?: number;
  offset?: number;
  /** Exact, or a family prefix such as "auth.%". */
  action?: string;
  actor_user_id?: string;
  /** Free text over the actor's name and email — never the event payload. */
  q?: string;
  actor_role?: string;
  target_type?: string;
  target_id?: string;
  ip_address?: string;
  /** Request path prefix, for the events the middleware net records. */
  path?: string;
  /** Super admin only; ignored for an ordinary admin. */
  organization_id?: string;
  since?: string;
  until?: string;
}

export interface AuditActor {
  id: string;
  name: string;
  email: string;
  role: string;
  events: number;
}

export interface AuditFacets {
  actions: string[];
  target_types: string[];
  roles: string[];
  organizations: { id: string; name: string; slug: string }[];
}

function toParams(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params;
}

export function listAuditEvents(query: AuditQuery = {}): Promise<AuditPage> {
  const qs = toParams(query).toString();
  return apiFetch<AuditPage>(`/admin/audit${qs ? `?${qs}` : ""}`, authed);
}

export function listAuditFacets(): Promise<AuditFacets> {
  return apiFetch<AuditFacets>("/admin/audit/actions", authed);
}

/**
 * The people who appear in the trail, busiest first.
 *
 * This is what makes "filter by user" a picker rather than a box you paste a
 * UUID into — nobody knows a colleague's UUID.
 */
export function listAuditActors(query?: string): Promise<AuditActor[]> {
  const qs = query ? `?q=${encodeURIComponent(query)}` : "";
  return apiFetch<AuditActor[]>(`/admin/audit/actors${qs}`, authed);
}

/**
 * The URL of the CSV export for the current filters.
 *
 * A plain link rather than a fetch: the browser's own download handling gets
 * the filename from the Content-Disposition header, and the session cookie
 * rides along because it is same-site.
 */
export function auditExportUrl(query: AuditQuery = {}): string {
  const qs = toParams(query).toString();
  return `${env.apiBaseUrl}${API_V1}/admin/audit/export${qs ? `?${qs}` : ""}`;
}

/**
 * Human wording for an action name.
 *
 * The stored value stays machine-readable (`auth.login_failed`) because that is
 * what filters and indexes work on; this is only the label. Unknown actions
 * fall back to a tidied version of the raw name rather than to "Unknown", so a
 * new event type added on the backend is still legible here before anyone
 * updates this map.
 */
const LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.logout": "Signed out",
  "auth.register": "Account created",
  "voice.session_started": "Started an AI tutor session",
  "voice.session_ended": "Ended an AI tutor session",
  "voice.interrupted": "Interrupted the tutor",
  "assessment.quiz_submitted": "Submitted a quiz",
  "assessment.assignment_submitted": "Submitted an assignment",
  "assessment.exam_submitted": "Submitted a certification exam",
  "assessment.certificate_issued": "Certificate issued",
  "progress.module_completed": "Completed a module",
  "progress.enrolled": "Enrolled in a course",
  "admin.user_created": "Created a user",
  "admin.role_changed": "Changed a role",
  "admin.attempt_granted": "Granted an extra attempt",
  "admin.mark_overridden": "Overrode a mark",
  "content.course_created": "Created a course",
  "content.course_updated": "Updated a course",
  "content.course_deleted": "Deleted a course",
  "content.material_uploaded": "Uploaded material",
  "content.material_deleted": "Deleted material",
  "billing.order_paid": "Payment completed",
  "message.sent": "Sent a message",
  "org.created": "Created an organisation",
  "org.user_created": "Added someone to an organisation",
  "org.user_updated": "Updated an organisation member",
  "org.role_changed": "Changed a role in an organisation",
  "org.document_uploaded": "Uploaded a document",
  "org.document_deleted": "Deleted a document",
  "org.course_created": "Created an organisation course",
  "org.course_updated": "Updated an organisation course",
  "org.platform_access": "Platform staff opened a customer's portal",
  "org.updated": "Updated an organisation",
  "org.branch_created": "Created a branch",
  "org.department_created": "Created a department",
  "admin.user_updated": "Edited a user",
  "admin.user_removed": "Removed a user",
  "admin.enrollments_set": "Changed someone's courses",
  "http.request": "Changed something",
};

export function actionLabel(action: string): string {
  const known = LABELS[action];
  if (known) return known;
  const tail = action.includes(".")
    ? action.split(".").slice(1).join(".")
    : action;
  const words = tail.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Colour family, so a failed sign-in does not look like a completed module. */
export function actionTone(
  action: string,
): "brand" | "success" | "warning" | "error" | "gray" {
  if (action === "auth.login_failed") return "error";
  if (action.startsWith("auth.")) return "brand";
  if (action.startsWith("admin.")) return "warning";
  if (action === "assessment.certificate_issued") return "success";
  if (action.startsWith("assessment.") || action.startsWith("progress."))
    return "success";
  if (action.startsWith("voice.")) return "brand";
  if (action.startsWith("billing.")) return "success";
  return "gray";
}
