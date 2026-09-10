/**
 * Assignment API calls.
 *
 * Note what is absent from `StudentAssignment`: there is no `accepted_answers`
 * field anywhere in the student types. The backend serves a different schema to
 * students than to authors, so the answer key never reaches the browser — and
 * because the types differ, a component cannot accidentally render it.
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

export type MatchMode = "exact" | "contains";

/** What a student is shown. No answer key. */
export interface AssignmentForStudent {
  id: string;
  module_id: string;
  title: string;
  prompt: string;
  max_score: number;
}

export interface Submission {
  id: string;
  assignment_id: string;
  attempt_number: number;
  answer: string;
  score: number;
  is_correct: boolean;
  feedback: string | null;
  graded_by: "auto" | "admin";
  submitted_at: string;
  graded_at: string;
}

export interface StudentAssignment {
  assignment: AssignmentForStudent;
  module_title: string;
  course_id: string;
  course_title: string;
  submissions: Submission[];
  best_score: number | null;
  is_complete: boolean;
}

/** The author's view — this one does carry the accepted answers. */
export interface AssignmentAdmin {
  id: string;
  module_id: string;
  title: string;
  prompt: string;
  accepted_answers: string[];
  match_mode: MatchMode;
  case_sensitive: boolean;
  max_score: number;
  created_at: string;
  updated_at: string;
}

export interface AssignmentInput {
  title: string;
  prompt: string;
  accepted_answers: string[];
  match_mode: MatchMode;
  case_sensitive: boolean;
  max_score: number;
}

export interface AdminSubmissionRow {
  id: string;
  assignment_id: string;
  assignment_title: string;
  module_title: string;
  course_title: string;
  max_score: number;
  user_id: string;
  user_name: string;
  user_email: string;
  attempt_number: number;
  answer: string;
  score: number;
  is_correct: boolean;
  feedback: string | null;
  graded_by: "auto" | "admin";
  graded_by_name: string | null;
  submitted_at: string;
}

// --- Student ---------------------------------------------------------------

export function listModuleAssignments(
  moduleId: string,
): Promise<StudentAssignment[]> {
  return apiFetch<StudentAssignment[]>(
    `/modules/${moduleId}/assignments`,
    authed,
  );
}

export function listMyAssignments(): Promise<StudentAssignment[]> {
  return apiFetch<StudentAssignment[]>("/assignments/mine", authed);
}

export function submitAssignment(
  assignmentId: string,
  answer: string,
): Promise<Submission> {
  return apiFetch<Submission>(`/assignments/${assignmentId}/submissions`, {
    ...authed,
    method: "POST",
    body: { answer },
  });
}

// --- Authoring -------------------------------------------------------------

export function listModuleAssignmentsAdmin(
  moduleId: string,
): Promise<AssignmentAdmin[]> {
  return apiFetch<AssignmentAdmin[]>(
    `/modules/${moduleId}/assignments/admin`,
    authed,
  );
}

export function createAssignment(
  moduleId: string,
  input: AssignmentInput,
): Promise<AssignmentAdmin> {
  return apiFetch<AssignmentAdmin>(`/modules/${moduleId}/assignments`, {
    ...authed,
    method: "POST",
    body: input,
  });
}

export function updateAssignment(
  assignmentId: string,
  input: Partial<AssignmentInput>,
): Promise<AssignmentAdmin> {
  return apiFetch<AssignmentAdmin>(`/assignments/${assignmentId}`, {
    ...authed,
    method: "PATCH",
    body: input,
  });
}

export function deleteAssignment(assignmentId: string): Promise<void> {
  return apiFetch<void>(`/assignments/${assignmentId}`, {
    ...authed,
    method: "DELETE",
  });
}

// --- Review ----------------------------------------------------------------

export function listAllSubmissions(): Promise<AdminSubmissionRow[]> {
  return apiFetch<AdminSubmissionRow[]>("/admin/submissions", authed);
}

export function overrideSubmission(
  submissionId: string,
  score: number,
  feedback: string | null,
): Promise<Submission> {
  return apiFetch<Submission>(`/admin/submissions/${submissionId}/override`, {
    ...authed,
    method: "POST",
    body: { score, feedback },
  });
}
