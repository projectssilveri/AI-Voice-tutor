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
import { roleLabel } from "@/lib/roles";

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
  "content.course_priced": "Changed a course's price",
  "content.module_created": "Added a module",
  "content.module_updated": "Edited a module",
  "content.module_deleted": "Deleted a module",
  "course.submitted_for_review": "Sent a course for approval",
  // A person changing their own settings. These had no entries, so they came
  // out of the fallback as "Photo set" and "Notifications changed" — and sat
  // beside the middleware's version of the same request, which read "Deleted
  // their own profile". One row, one sentence, and the sentence is true.
  "profile.photo_set": "Changed their profile photo",
  "profile.photo_removed": "Removed their profile photo",
  "profile.notifications_changed": "Changed their email settings",
  "profile.voice_changed": "Changed the tutor voice",
  "profile.account_closed": "Closed their own account",
  // THE CATCH-ALL, and the last place the word "something" survives.
  //
  // It used to be the label on every row the middleware recorded, which was
  // the loudest complaint in the issue log (41, 59, 60, 66) — a trail whose
  // most common entry was a shrug. Rows do not reach it any more: `eventLabel`
  // names them from their method and path first, and most of those routes now
  // write a real event of their own.
  //
  // What is left is the bucket in the action filter, and a row whose path
  // matches nothing in NOUNS. "Other changes" is the honest name for both, and
  // it is the name the group filter on the same screen already used.
  "http.request": "Other changes",
};

/**
 * Turn a bare HTTP request into a sentence.
 *
 * The catch-all exists so the trail is complete even where somebody forgot to
 * record an event. Completeness was never the problem — legibility was. A row
 * reading "Changed something · method: DELETE · path: /modules/8f3a..." holds
 * everything needed to say "Deleted a module" and said none of it.
 *
 * Deliberately coarse. This maps the shape of a path to the noun it acts on;
 * it does not try to name the individual record, because the id in the path is
 * a uuid and a uuid is not an answer. Routes that can name their target write
 * their own event with a `name` in the metadata.
 */
const VERBS: Record<string, string> = {
  POST: "Added",
  PUT: "Replaced",
  PATCH: "Edited",
  DELETE: "Deleted",
};

const NOUNS: [RegExp, string][] = [
  [/^\/courses\/[^/]+\/pricing/, "a course's price"],
  [/^\/courses\/[^/]+\/limits/, "a course's tutor limits"],
  [/^\/courses\/[^/]+\/submit-for-review/, "a course for approval"],
  [/^\/course-reviews\/[^/]+\/approve/, "a course approval"],
  [/^\/course-reviews\/[^/]+\/reject/, "a course rejection"],
  [/^\/courses/, "a course"],
  [/^\/modules\/[^/]+\/progress/, "module progress"],
  [/^\/modules/, "a module"],
  [/^\/assignments\/[^/]+\/submissions/, "an assignment submission"],
  [/^\/assignments/, "an assignment"],
  [/^\/quizzes|^\/questions/, "a quiz question"],
  [/^\/cert-exams\/[^/]+\/attempts/, "an exam attempt"],
  [/^\/cert-exams/, "a certification exam"],
  [/^\/admin\/users\/[^/]+\/enrollments/, "someone's courses"],
  [/^\/admin\/users\/[^/]+\/role/, "someone's role"],
  [/^\/admin\/users\/[^/]+\/active/, "whether an account is active"],
  [/^\/admin\/users\/[^/]+\/suspension-request/, "a suspension request"],
  [/^\/admin\/users\/[^/]+\/extensions/, "someone's access"],
  [/^\/admin\/users/, "a user"],
  [/^\/admin\/bundles/, "a bundle"],
  [/^\/admin\/refunds/, "a refund"],
  [/^\/organizations\/[^/]+\/members/, "an organisation member"],
  [/^\/organizations\/[^/]+\/documents/, "an organisation document"],
  [/^\/organizations/, "an organisation"],
  [/^\/org\//, "something in an organisation portal"],
  [/^\/materials/, "course material"],
  [/^\/messages/, "a message"],
  [/^\/payments/, "a payment"],
  [/^\/subscriptions/, "a subscription"],
  // Specific before general. `/profile` alone matched every route under it,
  // so DELETE /profile/photo came out as "Deleted their own profile" — a
  // photo removal described as an account deletion. These paths are skipped by
  // the net now and write their own events, so this is a backstop; it is here
  // because the general rule was wrong, not only unlucky.
  [/^\/profile\/photo/, "their profile photo"],
  [/^\/profile\/notifications/, "their email settings"],
  [/^\/profile\/voice/, "their tutor voice"],
  [/^\/profile\/close/, "their own account"],
  [/^\/profile/, "their own settings"],
  [/^\/enrollments|^\/courses\/[^/]+\/enroll/, "an enrolment"],
];

export function describeRequest(
  metadata: Record<string, unknown> | null,
): string | null {
  const method = typeof metadata?.method === "string" ? metadata.method : null;
  const path = typeof metadata?.path === "string" ? metadata.path : null;
  if (!method || !path) return null;

  const verb = VERBS[method];
  if (!verb) return null;

  const noun = NOUNS.find(([pattern]) => pattern.test(path))?.[1];
  if (!noun) return null;

  const status = Number(metadata?.status ?? 0);
  // A 4xx is a refusal, and reading it as though the change happened is the
  // opposite of the truth. The trail records attempts on purpose.
  if (status >= 400) return `Tried to change ${noun}, and was refused`;

  return `${verb} ${noun}`;
}

/**
 * What a row SAYS, ready to render. Call this, not the two below it.
 *
 * `actionLabel` alone is not enough for the catch-all: it answers "Changed
 * something", which is the shrug this whole file exists to get rid of. The
 * screens that got it right combined the two by hand, and the screens that did
 * not — the user dossier and the organisation audit trail — printed the shrug
 * for years. So the combining happens here, once.
 */
export function eventLabel(
  action: string,
  metadata: Record<string, unknown> | null,
): string {
  if (action === "http.request") {
    const described = describeRequest(metadata);
    if (described) return described;
  }
  return actionLabel(action);
}

/**
 * Where a request went, in words.
 *
 * Only the organisation portal, because that is the one place a PATH is
 * content rather than plumbing: a platform-access row exists to tell a
 * customer that an outsider read something of theirs, and which something is
 * the entire point.
 */
const ORG_PAGES: [RegExp, string][] = [
  [/\/org\/[^/]+\/members/, "their people"],
  [/\/org\/[^/]+\/structure/, "their branches and departments"],
  [/\/org\/[^/]+\/documents/, "their documents"],
  [/\/org\/[^/]+\/courses/, "their training"],
  [/\/org\/[^/]+\/deletion-requests/, "their deletion requests"],
  [/\/org\/[^/]+\/audit/, "this activity log"],
  [/\/org\/[^/]+$/, "their portal"],
];

export function orgPageOpened(
  metadata: Record<string, unknown> | null,
): string | null {
  const path = typeof metadata?.path === "string" ? metadata.path : null;
  if (!path) return null;
  return ORG_PAGES.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

/**
 * The details column, with the plumbing taken out.
 *
 * METHOD, PATH AND STATUS ARE NOT DETAILS on the catch-all. They are what
 * `eventLabel` is built from, so printing them underneath the sentence they
 * produced says the same thing twice in a worse language. The main audit
 * screen has dropped them for a while; the dossier printed "path:
 * /profile/photo · method: DELETE · status: 204" under a heading that already
 * said what happened.
 *
 * ON ANY OTHER ACTION THE PATH IS REAL. `org.platform_access` carried one and
 * the screen threw it away, so a customer opening their activity log saw five
 * rows reading "Platform staff opened a customer's portal" at the same second
 * with nothing to tell them apart. Pass the action and the path survives.
 *
 * Returns null when there is nothing left worth showing.
 */
const PLUMBING = new Set(["method", "path", "status"]);

export function eventDetails(
  metadata: Record<string, unknown> | null,
  action?: string,
): string | null {
  if (!metadata) return null;
  const drop = !action || action === "http.request" ? PLUMBING : new Set<string>();
  const parts = Object.entries(metadata)
    .filter(([key]) => !drop.has(key))
    .map(([key, value]) => {
      // Roles are stored as the column and read by people. A row saying
      // "role: admin" next to a table of Platform Admins is the same word
      // problem this map was made to fix.
      const shown =
        key === "role" && typeof value === "string"
          ? roleLabel(value)
          : typeof value === "boolean"
            ? value
              ? "yes"
              : "no"
            : String(value);
      return `${key.replace(/_/g, " ")}: ${shown}`;
    });
  return parts.length > 0 ? parts.join(" · ") : null;
}

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
