/**
 * Admin API calls.
 *
 * Every one of these is 403 for a non-admin. The client-side role check in
 * RequireAuth only decides what to render — this is what the data is actually
 * protected by.
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  enrollments: number;
  voice_sessions: number;
  voice_minutes: number;
  has_used_tutor: boolean;
  last_session_at: string | null;
  /**
   * Somebody has already asked for this account to be switched off and the
   * platform owner has not decided. The button says so rather than letting an
   * admin press it a second time and get an error back.
   */
  suspension_pending: boolean;
  /** Null for a public B2C account. Drives the organisation filter. */
  organization_id: string | null;
  organization_name: string | null;
}

/**
 * Super-admin only: promote or demote someone.
 *
 * The API refuses to change your own role or to demote another super admin,
 * so a mis-click cannot leave the platform with nobody able to hand out
 * permissions.
 */
export type AssignableRole = "student" | "admin" | "super_admin";

export function setUserRole(
  userId: string,
  // "teacher" is gone: nothing in the product distinguishes a tutor from an
  // admin, so it was an option that changed nothing anyone could see. Existing
  // teacher accounts keep the role — they just cannot be created any more.
  role: AssignableRole,
): Promise<AdminUserRow> {
  return apiFetch<AdminUserRow>(`/admin/users/${userId}/role`, {
    ...authed,
    method: "PATCH",
    body: { role },
  });
}

export interface ActivityLogRow {
  session_id: string;
  user_name: string;
  user_email: string;
  module_title: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  model_name: string;
  turns: number;
  interruptions: number;
}

export interface UsagePoint {
  day: string;
  sessions: number;
  minutes: number;
}

export interface ModuleUsageRow {
  module_title: string;
  sessions: number;
  minutes: number;
}

export interface UsageOverview {
  total_users: number;
  users_who_used_tutor: number;
  total_sessions: number;
  total_minutes: number;
  total_interruptions: number;
  sessions_per_day: UsagePoint[];
  top_modules: ModuleUsageRow[];
}

export interface GrantRow {
  id: string;
  user_name: string;
  user_email: string;
  exam_title: string;
  extra_attempts_granted: number;
  granted_by_name: string;
  reason: string | null;
  ts: string;
}

export interface AdminExam {
  id: string;
  title: string;
  course_title: string;
  default_max_attempts: number;
}

export interface AttemptOverviewRow {
  user_name: string;
  user_email: string;
  exam_title: string;
  attempts: number;
  best_score: number;
  passed: boolean;
}

export function listUsers(): Promise<AdminUserRow[]> {
  return apiFetch<AdminUserRow[]>("/admin/users", authed);
}

export function listActivity(limit = 50): Promise<ActivityLogRow[]> {
  return apiFetch<ActivityLogRow[]>(`/admin/activity?limit=${limit}`, authed);
}

export function getUsage(days = 14): Promise<UsageOverview> {
  return apiFetch<UsageOverview>(`/admin/usage?days=${days}`, authed);
}

export function listGrants(): Promise<GrantRow[]> {
  return apiFetch<GrantRow[]>("/admin/attempt-grants", authed);
}

export function listExams(): Promise<AdminExam[]> {
  return apiFetch<AdminExam[]>("/admin/cert-exams", authed);
}

export function listAttemptStats(): Promise<AttemptOverviewRow[]> {
  return apiFetch<AttemptOverviewRow[]>("/admin/stats/attempts", authed);
}

export function grantAttempts(payload: {
  user_id: string;
  cert_exam_id: string;
  extra_attempts: number;
  reason: string | null;
}): Promise<GrantRow> {
  return apiFetch<GrantRow>("/admin/attempt-grants", {
    ...authed,
    method: "POST",
    body: payload,
  });
}

// ---------------------------------------------------------------------------
// Creating, editing and removing people
// ---------------------------------------------------------------------------

export interface CreatedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export interface UserRemoval {
  /** "deleted" when the account had no history, "deactivated" when it did. */
  outcome: string;
  explanation: string;
}

export function createUser(payload: {
  name: string;
  email: string;
  password: string;
  role: string;
  phone?: string | null;
  course_ids?: string[];
}): Promise<CreatedUser> {
  return apiFetch<CreatedUser>("/admin/users", {
    withCredentials: true,
    method: "POST",
    body: payload,
  });
}

export interface SuspensionRow {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  user_is_active: boolean;
  reason: string;
  /** pending | approved | declined */
  status: string;
  requested_at: string;
  requested_by_name: string;
  requested_by_email: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
}

/**
 * Ask the platform owner to switch an account off.
 *
 * NOTHING HAPPENS TO THE ACCOUNT HERE. An admin can raise a problem the moment
 * they see it without being able to lock a customer out on their own; the
 * owner decides. The reason is required — the server refuses an empty one.
 */
export function requestSuspension(
  userId: string,
  reason: string,
): Promise<SuspensionRow> {
  return apiFetch<SuspensionRow>(`/admin/users/${userId}/suspension-request`, {
    ...authed,
    method: "POST",
    body: { reason },
  });
}

/** Super admin only. */
export function listSuspensionRequests(
  status?: string,
): Promise<SuspensionRow[]> {
  const query = status ? `?status_filter=${encodeURIComponent(status)}` : "";
  return apiFetch<SuspensionRow[]>(
    `/admin/suspension-requests${query}`,
    authed,
  );
}

/** Super admin only. Approving switches the account off. */
export function decideSuspension(
  requestId: string,
  approve: boolean,
  note?: string,
): Promise<SuspensionRow> {
  return apiFetch<SuspensionRow>(
    `/admin/suspension-requests/${requestId}/${approve ? "approve" : "decline"}`,
    { ...authed, method: "POST", body: { note } },
  );
}

/** Super admin only — suspend or restore without waiting for a request. */
export function setUserActive(
  userId: string,
  active: boolean,
  reason?: string,
): Promise<SuspensionRow | null> {
  return apiFetch<SuspensionRow | null>(`/admin/users/${userId}/active`, {
    ...authed,
    method: "POST",
    body: { active, reason },
  });
}

export function updateUser(
  id: string,
  payload: {
    name?: string;
    phone?: string | null;
    /**
     * The sign-in identifier. Changing it changes the address the person has
     * to type, which is why the screen says so before saving — and why it is
     * editable at all: an address typed wrong at creation locked the account
     * with no way to put it right.
     */
    email?: string;
  },
): Promise<CreatedUser> {
  return apiFetch<CreatedUser>(`/admin/users/${id}`, {
    withCredentials: true,
    method: "PATCH",
    body: payload,
  });
}

export function removeUser(id: string): Promise<UserRemoval> {
  return apiFetch<UserRemoval>(`/admin/users/${id}`, {
    withCredentials: true,
    method: "DELETE",
  });
}

export function setUserEnrollments(
  id: string,
  courseIds: string[],
): Promise<string[]> {
  return apiFetch<string[]>(`/admin/users/${id}/enrollments`, {
    withCredentials: true,
    method: "PUT",
    body: { course_ids: courseIds },
  });
}

// ---------------------------------------------------------------------------
// One person, completely
// ---------------------------------------------------------------------------

export interface DossierCourse {
  course_id: string;
  course_title: string;
  enrolled_at: string | null;
  modules_total: number;
  modules_completed: number;
  modules_in_progress: number;
  percent: number;
  last_activity_at: string | null;
  purchased_at: string | null;
  /** Null on a course bought outright — that genuinely never expires. */
  expires_at: string | null;
  access_via: string;
}

export interface DossierQuiz {
  module_id: string;
  module_title: string;
  course_title: string;
  questions: number;
  attempts: number;
  best_score: number | null;
  last_attempt_at: string | null;
  taken: boolean;
}

export interface DossierAssignment {
  assignment_id: string;
  title: string;
  module_title: string;
  attempts: number;
  best_score: number | null;
  last_submitted_at: string | null;
}

export interface DossierCertAttempt {
  attempt_number: number;
  score: number;
  passed: boolean;
  taken_at: string;
}

export interface DossierCertification {
  exam_id: string;
  exam_title: string;
  course_title: string;
  used_attempts: number;
  allowed_attempts: number;
  extra_granted: number;
  best_score: number | null;
  passed: boolean;
  certificate_id: string | null;
  certificate_issued_at: string | null;
  attempts: DossierCertAttempt[];
}

export interface DossierSession {
  id: string;
  module_title: string | null;
  course_title: string | null;
  started_at: string;
  ended_at: string | null;
  minutes: number;
}

export interface DossierActivity {
  action: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
  target_type: string | null;
  metadata: Record<string, unknown> | null;
}

export interface UserDossier {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  created_at: string;

  organization_name: string | null;
  branch_name: string | null;
  department_name: string | null;

  total_courses: number;
  total_modules_completed: number;
  total_quiz_attempts: number;
  total_assignments: number;
  certificates_earned: number;
  certification_attempts: number;
  voice_sessions: number;
  voice_minutes: number;
  last_login_at: string | null;
  last_logout_at: string | null;
  login_count: number;

  courses: DossierCourse[];
  quizzes: DossierQuiz[];
  assignments: DossierAssignment[];
  certifications: DossierCertification[];
  sessions: DossierSession[];
  activity: DossierActivity[];
}

export function getUserDossier(id: string): Promise<UserDossier> {
  return apiFetch<UserDossier>(`/admin/users/${id}/dossier`, {
    withCredentials: true,
    cache: "no-store",
  });
}

// ---------------------------------------------------------------------------
// Extending how long somebody keeps a course
// ---------------------------------------------------------------------------

export interface AccessExtension {
  id: string;
  course_id: string | null;
  course_title: string | null;
  plan_id: string | null;
  plan_name: string | null;
  extends_to: string;
  granted_by_name: string | null;
  reason: string | null;
  created_at: string;
}

/**
 * Give somebody longer on a course, or on everything in a plan.
 *
 * A grant, not an edit: `access_extensions` records who, when and why, the way
 * `attempt_grants` does for certification attempts. Grants only ever push a
 * date later, so a mistyped one cannot take access away.
 */
export function grantExtension(
  userId: string,
  payload: {
    course_id?: string;
    plan_id?: string;
    extends_to: string;
    reason?: string;
  },
): Promise<AccessExtension> {
  return apiFetch<AccessExtension>(`/admin/users/${userId}/extensions`, {
    withCredentials: true,
    method: "POST",
    body: payload,
  });
}

export function listExtensions(userId: string): Promise<AccessExtension[]> {
  return apiFetch<AccessExtension[]>(`/admin/users/${userId}/extensions`, {
    withCredentials: true,
    cache: "no-store",
  });
}
