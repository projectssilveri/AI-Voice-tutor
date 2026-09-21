/**
 * The organization portal — /org/{slug}/...
 *
 * Every call is scoped by the slug in the path, and the backend asserts the
 * caller belongs to that organization before answering. Nothing here decides
 * access; it only asks.
 */

import { apiFetch } from "@/lib/api";
import { roleLabel as platformRole } from "@/lib/roles";
import { API_V1, env } from "@/lib/env";

const authed = { withCredentials: true, cache: "no-store" } as const;

/** The one thing an anonymous visitor may read: enough to brand a login page. */
export interface PublicOrg {
  name: string;
  slug: string;
}

export interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  my_role: string;
  is_org_admin: boolean;
  /** Platform staff inside a customer's tenant. Their visit is recorded. */
  is_platform_staff: boolean;
  branch_id: string | null;
  branch_name: string | null;

  /**
   * A department's own administrator — the HR admin, the sales admin. They run
   * the people in `department_id` and write that department's training, and
   * they see nothing of any other department's.
   */
  is_dept_admin: boolean;
  department_id: string | null;
  department_name: string | null;

  /**
   * What this person may do, decided by the server rather than re-derived from
   * `my_role` here. Presentation only — every route re-checks — but one rule
   * in one place is what stops the nav offering a screen the API refuses.
   */
  can_manage_people: boolean;
  can_author: boolean;
}

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  branch_id: string | null;
  branch_name: string | null;
  department_id: string | null;
  department_name: string | null;
  /** Sees training scoped to OTHER departments — the HR/IT manager case. */
  sees_all_departments: boolean;
  created_at: string;
}

export interface MemberList {
  members: OrgMember[];
  total: number;
  admin_count: number;
  min_admins: number;
}

export interface OrgStructure {
  branches: { id: string; name: string; is_active: boolean }[];
  departments: {
    id: string;
    name: string;
    branch_id: string | null;
    branch_name: string | null;
  }[];
}

export interface OrgAuditEvent {
  id: string;
  action: string;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
  target_type: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
}

/** Roles an organization may hand out. Platform roles are absent by design. */
export const ORG_ROLES = [
  { value: "student", label: "Learner", hint: "Takes courses" },
  {
    value: "dept_admin",
    label: "Department admin",
    hint: "Runs one department: its people and its training, and nothing else",
  },
  {
    value: "branch_manager",
    label: "Branch manager",
    hint: "Sees their own branch's people and progress",
  },
  {
    value: "org_admin",
    label: "Administrator",
    hint: "Manages everyone, the structure and the training",
  },
] as const;

/**
 * What a role is called INSIDE one company's portal.
 *
 * `org_admin` is just "Administrator" here, because the whole screen is that
 * organisation and repeating the word adds nothing.
 *
 * Falls through to the platform map for anybody who is not one of these. A
 * super admin visiting a customer is not an org role, so this returned the raw
 * column and the header read "super_admin" under their name.
 */
export function roleLabel(role: string): string {
  return ORG_ROLES.find((r) => r.value === role)?.label ?? platformRole(role);
}

export function getPublicOrg(slug: string): Promise<PublicOrg> {
  return apiFetch<PublicOrg>(`/public/org/${slug}`, { cache: "no-store" });
}

export function getOrgProfile(slug: string): Promise<OrgProfile> {
  return apiFetch<OrgProfile>(`/org/${slug}`, authed);
}

export function getOrgStructure(slug: string): Promise<OrgStructure> {
  return apiFetch<OrgStructure>(`/org/${slug}/structure`, authed);
}

export function listMembers(slug: string): Promise<MemberList> {
  return apiFetch<MemberList>(`/org/${slug}/members`, authed);
}

export function createMember(
  slug: string,
  body: {
    name: string;
    email: string;
    password: string;
    role: string;
    branch_id?: string | null;
    department_id?: string | null;
  },
): Promise<OrgMember> {
  return apiFetch<OrgMember>(`/org/${slug}/members`, {
    ...authed,
    method: "POST",
    body,
  });
}

export function updateMember(
  slug: string,
  memberId: string,
  body: {
    name?: string;
    role?: string;
    is_active?: boolean;
    branch_id?: string | null;
    department_id?: string | null;
    sees_all_departments?: boolean;
  },
): Promise<OrgMember> {
  return apiFetch<OrgMember>(`/org/${slug}/members/${memberId}`, {
    ...authed,
    method: "PATCH",
    body,
  });
}

export interface MemberRemoval {
  /**
   * "deleted" when the account had no history, "deactivated" when it did —
   * and "requested" when nothing happened at all because the person pressing
   * was not an administrator.
   */
  outcome: string;
  explanation: string;
}

/**
 * Remove someone from the organization, or ask an administrator to.
 *
 * AN ADMINISTRATOR REMOVES. The account is deleted outright when it has no
 * history and closed when it does — the server decides which and says so in
 * `explanation`, because an admin who presses Delete and later finds the
 * person still in the audit trail needs to have been told why.
 *
 * A BRANCH OR DEPARTMENT MANAGER ASKS. Nothing is touched, `outcome` comes
 * back "requested", and it waits in the administrators' queue. Check that
 * rather than announcing a removal that has not happened.
 */
export function removeMember(
  slug: string,
  memberId: string,
  reason = "",
): Promise<MemberRemoval> {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  return apiFetch<MemberRemoval>(
    `/org/${slug}/members/${memberId}${query}`,
    { ...authed, method: "DELETE" },
  );
}

// ---------------------------------------------------------------------------
// Deletions waiting on this organization's administrators
// ---------------------------------------------------------------------------

export interface DeletionRequestRow {
  id: string;
  /** member | training | document */
  target_type: string;
  target_id: string;
  /**
   * The name, captured when the request was raised. After an approval the id
   * points at nothing, which is why the server stores this rather than joining.
   */
  target_label: string;
  reason: string;
  /** pending | approved | declined */
  status: string;
  requested_at: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
  /** You asked for this, so somebody else has to decide it. */
  requested_by_me: boolean;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  outcome: string | null;
}

/** What is waiting on this organization's administrators. Admins only. */
export function listDeletionRequests(
  slug: string,
  includeDecided = false,
): Promise<DeletionRequestRow[]> {
  const query = includeDecided ? "?include_decided=true" : "";
  return apiFetch<DeletionRequestRow[]>(
    `/org/${slug}/deletion-requests${query}`,
    authed,
  );
}

/** Agree. The thing is destroyed in the same transaction as the record of it. */
export function approveDeletion(
  slug: string,
  requestId: string,
  note?: string,
): Promise<DeletionRequestRow> {
  return apiFetch<DeletionRequestRow>(
    `/org/${slug}/deletion-requests/${requestId}/approve`,
    { ...authed, method: "POST", body: { note: note || null } },
  );
}

/**
 * Refuse. Nothing is touched.
 *
 * The note is REQUIRED by the server, for the same reason rejecting a course
 * is: a refusal that says nothing tells the person who asked nothing they can
 * act on, so they ask again next week.
 */
export function declineDeletion(
  slug: string,
  requestId: string,
  note: string,
): Promise<DeletionRequestRow> {
  return apiFetch<DeletionRequestRow>(
    `/org/${slug}/deletion-requests/${requestId}/decline`,
    { ...authed, method: "POST", body: { note } },
  );
}

export function listOrgAudit(
  slug: string,
  query: { limit?: number; offset?: number; action?: string } = {},
): Promise<{
  events: OrgAuditEvent[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return apiFetch(`/org/${slug}/audit${qs ? `?${qs}` : ""}`, authed);
}

/**
 * The signed-in person's own organization slug, or null.
 *
 * The session carries `organization_id` but not the slug — the slug belongs to
 * the organization, not to the person, and duplicating it onto every session
 * response would mean two places for it to go stale after a rename.
 */
export async function getMyOrganizationSlug(): Promise<string | null> {
  const me = await apiFetch<{ slug: string } | null>("/org/mine", authed);
  return me?.slug ?? null;
}

// ---------------------------------------------------------------------------
// Documents and org-authored courses
// ---------------------------------------------------------------------------

export type DocumentVisibility = "organization" | "branch" | "department";

export interface OrgDocument {
  id: string;
  title: string;
  description: string | null;
  filename: string;
  size_bytes: number;
  content_type: string;
  visibility: DocumentVisibility;
  branch_id: string | null;
  department_id: string | null;
  created_at: string;
  uploaded_by: string;
  /** False for a scanned PDF, which yields no text to offer the tutor. */
  has_text: boolean;
  /**
   * Whether THIS viewer may delete it. A department admin looks after their
   * own department's files; the company handbook is theirs to read and the
   * organisation admin's to look after.
   */
  can_edit: boolean;
}

export interface OrgCourse {
  /** Null means everyone in the organization. */
  department_id?: string | null;
  department_name?: string | null;
  id: string;
  title: string;
  description: string | null;
  is_published: boolean;
  module_count: number;
  /**
   * Whether THIS viewer may change it, as opposed to merely see it. A
   * department admin sees the company-wide courses everyone sees and cannot
   * touch them; without this the screen would offer an Edit button the server
   * answers with a 403.
   */
  can_edit: boolean;
}

export function listOrgDocuments(
  slug: string,
): Promise<{ documents: OrgDocument[]; total: number }> {
  return apiFetch(`/org/${slug}/documents`, authed);
}

/**
 * Upload a PDF.
 *
 * Sent as multipart with the metadata in the query string, because a file and
 * JSON cannot share one body. `apiFetch` is bypassed deliberately: it sets a
 * JSON Content-Type, and a multipart request must let the browser set its own
 * so the boundary token is correct.
 */
export async function uploadOrgDocument(
  slug: string,
  file: File,
  meta: {
    title: string;
    description?: string;
    visibility: DocumentVisibility;
    branch_id?: string | null;
    department_id?: string | null;
  },
): Promise<OrgDocument> {
  const params = new URLSearchParams({
    title: meta.title,
    visibility: meta.visibility,
  });
  if (meta.description) params.set("description", meta.description);
  if (meta.branch_id) params.set("branch_id", meta.branch_id);
  if (meta.department_id) params.set("department_id", meta.department_id);

  const body = new FormData();
  body.append("file", file);

  const response = await fetch(
    `${env.apiBaseUrl}${API_V1}/org/${slug}/documents?${params}`,
    { method: "POST", credentials: "include", body },
  );
  if (!response.ok) {
    let detail = "Could not upload that file.";
    try {
      detail = (await response.json()).detail ?? detail;
    } catch {
      // A non-JSON error body is not worth failing over; the default reads
      // better than a raw status code anyway.
    }
    throw new Error(detail);
  }
  return response.json();
}

export function orgDocumentUrl(slug: string, documentId: string): string {
  return `${env.apiBaseUrl}${API_V1}/org/${slug}/documents/${documentId}/file`;
}

/**
 * Remove a file, or ask an administrator to.
 *
 * Same split as `removeMember`: an org admin removes it, anybody else raises a
 * request and the file is untouched. The server answers 202 with no body in
 * that case, so the caller cannot tell from the return value alone — reload the
 * list and the file being still there is the answer.
 */
export function deleteOrgDocument(
  slug: string,
  documentId: string,
  reason = "",
): Promise<void> {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  return apiFetch(`/org/${slug}/documents/${documentId}${query}`, {
    ...authed,
    method: "DELETE",
  });
}

export function getOrgDocumentText(
  slug: string,
  documentId: string,
): Promise<{ title: string; text: string | null }> {
  return apiFetch(`/org/${slug}/documents/${documentId}/text`, authed);
}

export function listOrgCourses(slug: string): Promise<OrgCourse[]> {
  return apiFetch(`/org/${slug}/courses`, authed);
}

export function createOrgCourse(
  slug: string,
  body: {
    title: string;
    description?: string | null;
    /** Narrows it to one department. Omit for everyone in the organization. */
    department_id?: string | null;
  },
): Promise<OrgCourse> {
  return apiFetch(`/org/${slug}/courses`, { ...authed, method: "POST", body });
}

export function updateOrgCourse(
  slug: string,
  courseId: string,
  body: {
    title?: string;
    description?: string | null;
    is_published?: boolean;
    /** Send null explicitly to widen it back to the whole organization. */
    department_id?: string | null;
  },
): Promise<OrgCourse> {
  return apiFetch(`/org/${slug}/courses/${courseId}`, {
    ...authed,
    method: "PATCH",
    body,
  });
}

export function createOrgModule(
  slug: string,
  courseId: string,
  // `order` omitted means append; the server reads the highest position
  // that exists. This screen used to send the module COUNT, which collides
  // with an existing module as soon as one has been deleted.
  body: { title: string; order?: number; content?: string | null },
): Promise<{ id: string; title: string; order: number; has_content: boolean }> {
  return apiFetch(`/org/${slug}/courses/${courseId}/modules`, {
    ...authed,
    method: "POST",
    body,
  });
}

/** Human file size. 1366 bytes reads better as "1.3 KB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Somebody in the organization who can actually take a given course. */
export interface OrgLearner {
  id: string;
  name: string;
  email: string;
  branch_name: string | null;
}

/**
 * Who a course actually reaches.
 *
 * Scoped to the course's department server-side, so a course narrowed to one
 * department reports only that department's learners. That is the number worth
 * showing: an author who has just narrowed a course wants to know how many
 * people can still see it.
 */
export function courseAudience(
  slug: string,
  courseId: string,
): Promise<OrgLearner[]> {
  return apiFetch<OrgLearner[]>(
    `/org/${slug}/courses/${courseId}/audience`,
    authed,
  );
}
