/**
 * Quiz and certification API calls.
 *
 * Note what is absent from `QuizQuestionForStudent`: there is no
 * `correct_answer`. The backend does not send one while an attempt is in
 * progress, so the answer key cannot be read out of the network tab.
 */

import { apiFetch } from "@/lib/api";
import { API_V1, env } from "@/lib/env";

const authed = { withCredentials: true, cache: "no-store" } as const;

/**
 * URL of the certificate PDF.
 *
 * Returned as a URL rather than fetched, so the anchor can hand it straight to
 * the browser's PDF viewer — the session cookie is sent with the navigation
 * and nothing has to be buffered in memory.
 */
export function certificateDownloadUrl(examId: string): string {
  return `${env.apiBaseUrl}${API_V1}/cert-exams/${examId}/certificate`;
}

/** A certificate this student holds. */
export interface EarnedCertificate {
  id: string;
  cert_exam_id: string;
  exam_title: string;
  course_id: string;
  course_title: string;
  issued_at: string;
  score: number | null;
}

export function listMyCertificates(): Promise<EarnedCertificate[]> {
  return apiFetch<EarnedCertificate[]>("/certificates/mine", authed);
}

export interface QuizQuestionForStudent {
  id: string;
  question: string;
  options: string[];
}

export interface ModuleQuiz {
  module_id: string;
  module_title: string;
  questions: QuizQuestionForStudent[];
  /** Display only — quizzes have unlimited retakes. */
  attempts_taken: number;
  best_score: number | null;
}

export interface QuizAnswerResult {
  question_id: string;
  question: string;
  options: string[];
  selected: number | null;
  /**
   * Which option was right. Practice quizzes only.
   *
   * The certification exam never sends this: its result is a score and a
   * standing, and its paper has no answer field at all.
   */
  correct_answer: number;
  is_correct: boolean;
}

export interface QuizResult {
  attempt_id: string;
  attempt_number: number;
  score: number;
  correct_count: number;
  total_questions: number;
  /**
   * Whether that was a pass. The screen used to print the percentage and stop,
   * so a student on 65% saw a number, a Retake button and no verdict, then
   * found out from a different screen that the module would not tick off.
   */
  passed: boolean;
  /** The bar, from the server. Never a second copy of 70 kept over here. */
  pass_mark: number;
  results: QuizAnswerResult[];
}

export interface QuizAttemptSummary {
  id: string;
  module_id: string;
  score: number;
  attempt_number: number;
  ts: string;
}

export interface AttemptStanding {
  allowed_attempts: number;
  used_attempts: number;
  remaining_attempts: number;
  can_attempt: boolean;
  base_attempts: number;
  granted_attempts: number;
  passed: boolean;
  certificate_issued_at: string | null;
  /** A paper left unsubmitted, waiting to be resumed. Null when none is open. */
  open_attempt_number: number | null;
  lapses_used: number;
  lapses_allowed: number;
}

export interface CertExam {
  id: string;
  course_id: string;
  title: string;
  default_max_attempts: number;
  /** The score that passes, out of 100. Was never sent to the screen. */
  pass_mark: number;
  /**
   * Whether the course behind this exam has been finished. A locked exam is
   * still listed — a student needs to see what is left, not have the exam
   * quietly disappear — but the paper and the submit route both refuse it.
   */
  modules_total: number;
  modules_completed: number;
  unlocked: boolean;
  locked_reason: string | null;
}

export interface CertExamDetail extends CertExam {
  standing: AttemptStanding;
  question_count: number;
}

export interface CertAttempt {
  id: string;
  attempt_number: number;
  score: number;
  passed: boolean;
  ts: string;
}

export interface CertExamResult {
  attempt: CertAttempt;
  standing: AttemptStanding;
  certificate_issued: boolean;
}

export interface Answer {
  question_id: string;
  selected: number;
}

// --- quizzes ---------------------------------------------------------------

export function getModuleQuiz(moduleId: string): Promise<ModuleQuiz> {
  return apiFetch<ModuleQuiz>(`/modules/${moduleId}/quiz`, authed);
}

export function submitQuiz(
  moduleId: string,
  answers: Answer[],
): Promise<QuizResult> {
  return apiFetch<QuizResult>(`/modules/${moduleId}/quiz/attempts`, {
    ...authed,
    method: "POST",
    body: { answers },
  });
}

export function listQuizAttempts(
  moduleId: string,
): Promise<QuizAttemptSummary[]> {
  return apiFetch<QuizAttemptSummary[]>(
    `/modules/${moduleId}/quiz/attempts`,
    authed,
  );
}

// --- certification ---------------------------------------------------------

export function listCourseExams(courseId: string): Promise<CertExam[]> {
  return apiFetch<CertExam[]>(`/courses/${courseId}/cert-exams`, authed);
}

/**
 * Create the certification exam for a course.
 *
 * The endpoint has existed since certification was built and nothing in the
 * product ever called it, so an author had no way to turn certification on.
 * Issues 72 and 73.
 */
export function createCourseExam(
  courseId: string,
  input: { title: string; default_max_attempts: number | null },
): Promise<CertExam> {
  return apiFetch<CertExam>(`/courses/${courseId}/cert-exams`, {
    ...authed,
    method: "POST",
    body: input,
  });
}

export interface LapseResult {
  lapses_used: number;
  lapses_allowed: number;
  /** The allowance is gone; the paper must be submitted as it stands. */
  must_submit: boolean;
}

/**
 * Tell the server the student left the exam.
 *
 * THE SERVER KEEPS THE COUNT, not the browser. The proctor used to hold it in
 * a ref and clear it every time a paper opened, and papers are resumable now,
 * so the budget reset every time somebody came back. It lives on the attempt
 * row instead.
 */
export function recordLapse(examId: string): Promise<LapseResult> {
  return apiFetch<LapseResult>(`/cert-exams/${examId}/lapse`, {
    ...authed,
    method: "POST",
  });
}

export function getExam(examId: string): Promise<CertExamDetail> {
  return apiFetch<CertExamDetail>(`/cert-exams/${examId}`, authed);
}

export function getExamQuestions(
  examId: string,
): Promise<QuizQuestionForStudent[]> {
  return apiFetch<QuizQuestionForStudent[]>(
    `/cert-exams/${examId}/questions`,
    authed,
  );
}

export function submitExam(
  examId: string,
  answers: Answer[],
  /**
   * How many times the student left the exam during this attempt.
   *
   * Recorded against the attempt so an admin can see it when a mark is
   * queried. Never shown to the student — see `hooks/useExamProctor` for why
   * the budget is not published.
   */
  lapses?: number,
  /** True when leaving is what ended the attempt, rather than a Submit press. */
  endedByLeaving = false,
): Promise<CertExamResult> {
  return apiFetch<CertExamResult>(`/cert-exams/${examId}/attempts`, {
    ...authed,
    method: "POST",
    body: lapses
      ? { answers, lapses, ended_by_leaving: endedByLeaving }
      : { answers },
  });
}

export function listExamAttempts(examId: string): Promise<CertAttempt[]> {
  return apiFetch<CertAttempt[]>(`/cert-exams/${examId}/attempts`, authed);
}
