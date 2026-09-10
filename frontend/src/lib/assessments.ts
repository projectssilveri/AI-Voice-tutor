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
  correct_answer: number;
  is_correct: boolean;
}

export interface QuizResult {
  attempt_id: string;
  attempt_number: number;
  score: number;
  correct_count: number;
  total_questions: number;
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
}

export interface CertExam {
  id: string;
  course_id: string;
  title: string;
  default_max_attempts: number;
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
