"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import PaywallNotice from "@/components/assessments/PaywallNotice";
import QuestionList from "@/components/assessments/QuestionList";
import ResultReview from "@/components/assessments/ResultReview";
import { ApiError, errorText } from "@/lib/api";
import {
  type ModuleQuiz,
  type QuizAttemptSummary,
  type QuizResult,
  getModuleQuiz,
  listQuizAttempts,
  submitQuiz,
} from "@/lib/assessments";
import { Skeleton, SkeletonPanel } from "@/components/ui/Skeleton";
import { PracticeQuizBadge } from "@/components/assessments/AssessmentBadge";

/**
 * Module quiz. UNLIMITED retakes.
 *
 * There is deliberately no "attempts remaining" anywhere on this screen —
 * the original spec caps certification exams only, and showing a count here would
 * imply a limit that does not exist.
 */
export default function QuizPage() {
  const { courseId, moduleId } = useParams<{
    courseId: string;
    moduleId: string;
  }>();

  const [quiz, setQuiz] = useState<ModuleQuiz | null>(null);
  const [attempts, setAttempts] = useState<QuizAttemptSummary[]>([]);
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The error object, not just its message: a 402 needs different treatment
  // from a network failure, and the status only survives on the object.
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [nextQuiz, nextAttempts] = await Promise.all([
        getModuleQuiz(moduleId),
        listQuizAttempts(moduleId),
      ]);
      setQuiz(nextQuiz);
      setAttempts(nextAttempts);
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught);
      setError(
        errorText(caught, "Could not load the quiz."),
      );
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit() {
    if (!quiz) return;
    setSubmitting(true);
    setError(null);
    try {
      const answers = Object.entries(selections).map(
        ([question_id, selected]) => ({ question_id, selected }),
      );
      setResult(await submitQuiz(moduleId, answers));
      setAttempts(await listQuizAttempts(moduleId));
    } catch (caught) {
      setError(
        errorText(caught, "Could not submit the quiz."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function retake() {
    setResult(null);
    setSelections({});
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-3 h-7 w-64" />
        </div>
        <SkeletonPanel lines={5} />
      </div>
    );
  }

  if (!quiz || quiz.questions.length === 0) {
    return (
      <div className="space-y-4">
        <Link
          href={`/learn/${courseId}/${moduleId}`}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          ← Back to module
        </Link>
        {/* A locked course answers 402; that needs somewhere to go, not just a
            sentence. Anything else falls through to the plain message. */}
        <PaywallNotice error={loadError} courseId={courseId} />
        {!(loadError instanceof ApiError && loadError.status === 402) ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {error ?? "This module has no quiz yet."}
          </p>
        ) : null}
      </div>
    );
  }

  const answeredCount = Object.keys(selections).length;
  const allAnswered = answeredCount === quiz.questions.length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/learn/${courseId}/${moduleId}`}
          className="mb-2 inline-block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          ← Back to module
        </Link>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          Quiz: {quiz.module_title}
        </h1>
        <PracticeQuizBadge questions={quiz.questions.length} />
      </div>

      {error ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 text-center dark:border-gray-800 dark:bg-white/[0.03]">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Attempt #{result.attempt_number}
            </p>
            {/* THE VERDICT, not just the number. This showed a percentage
                and a Retake button and left the student to work out whether
                they had passed — while the module refused to complete below
                the mark and said so on a different screen. */}
            <p
              className={`my-2 text-title-md font-bold ${
                result.passed
                  ? "text-success-700 dark:text-success-400"
                  : "text-error-700 dark:text-error-400"
              }`}
            >
              {result.score}%
            </p>
            <p className="text-sm font-medium text-gray-800 dark:text-white/90">
              {result.passed
                ? "Passed."
                : `Not passed. You need ${result.pass_mark}% to finish this module.`}
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {result.correct_count} of {result.total_questions} correct
            </p>
            <button
              type="button"
              onClick={retake}
              className="mt-5 rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              {result.passed ? "Take it again" : "Try again"}
            </button>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
              Review
            </h2>
            <ResultReview results={result.results} />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          {/* The same navigator the exam uses. Quizzes are unlimited, so there
              is no confirmation step here — but "which ones have I done" is
              the same question on a long quiz as on an exam. */}
          {quiz.questions.length > 3 ? (
            <div className="mb-5 flex flex-wrap items-center gap-1.5 border-b border-gray-200 pb-4 dark:border-gray-800">
              {quiz.questions.map((question, index) => {
                const done = selections[question.id] !== undefined;
                return (
                  <button
                    key={question.id}
                    type="button"
                    aria-label={`Question ${index + 1}${done ? ", answered" : ", not answered"}`}
                    onClick={() =>
                      document
                        .getElementById(`quiz-q-${index}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className={`h-7 w-7 rounded-md text-xs font-medium transition ${
                      done
                        ? "bg-brand-500 text-white hover:bg-brand-600"
                        : "border border-gray-300 text-gray-500 hover:border-brand-400 dark:border-gray-700 dark:text-gray-400"
                    }`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          ) : null}

          <QuestionList
            questions={quiz.questions}
            selections={selections}
            onSelect={(questionId, index) =>
              setSelections((current) => ({ ...current, [questionId]: index }))
            }
            idPrefix="quiz-q"
          />

          <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-gray-200 pt-5 dark:border-gray-800">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || answeredCount === 0}
              className="rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit quiz"}
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {answeredCount} of {quiz.questions.length} answered
              {!allAnswered && answeredCount > 0
                ? ". Unanswered questions count as wrong"
                : ""}
            </span>
          </div>
        </div>
      )}

      {attempts.length > 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
            Previous attempts
          </h2>
          <ul className="space-y-2">
            {attempts.map((attempt) => (
              <li
                key={attempt.id}
                className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2 text-sm dark:bg-white/[0.03]"
              >
                <span className="text-gray-600 dark:text-gray-400">
                  Attempt #{attempt.attempt_number} ·{" "}
                  {new Date(attempt.ts).toLocaleString()}
                </span>
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {attempt.score}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
